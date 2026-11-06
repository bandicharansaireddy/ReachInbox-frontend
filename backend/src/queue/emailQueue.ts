import crypto from 'crypto';

import { Job, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { env } from '../config/env.ts';
import { prisma } from '../lib/prisma.ts';
import { sendEmailMessage } from '../services/emailSender.ts';
import { indexEmailRecord } from '../services/emailSearchService.ts';
import { sendRateLimitSlackNotification } from '../services/slackService.ts';

export const EMAIL_QUEUE_NAME = 'reachinbox-email-delivery';

export function buildEmailJobId(emailId: string, scheduledForIso: string) {
  const hash = crypto.createHash('sha256').update(`${emailId}:${scheduledForIso}`).digest('hex');
  return `email:${emailId}:${hash}`;
}

export function shouldSkipEmailProcessing(email: { status: string }) {
  return ['SENT', 'FAILED', 'QUEUED'].includes(email.status);
}

export function getRetryDelay(attempt: number) {
  return Math.min(30_000 * attempt, 300_000);
}

export type RateLimitDecision = {
  allowed: boolean;
  reason: 'ok' | 'hourly_limit' | 'min_delay';
  retryAtMs: number | null;
  currentCount: number;
  hourlyLimit: number;
  senderId: string;
};

export function getSenderRateLimitWindow(senderId: string, now = new Date()) {
  const start = new Date(now);
  start.setMinutes(0);
  start.setSeconds(0, 0);
  return {
    windowKey: `sender:${senderId}:hour:${start.toISOString()}`,
    lastSentKey: `sender:${senderId}:last-sent-at`,
    windowStart: start.getTime(),
    windowEnd: start.getTime() + 60 * 60 * 1000,
  };
}

export function createSenderRateLimiter({ redis = new Redis(env.REDIS_URL) } = {}) {
  return {
    async reserveSendSlot({
      senderId,
      minDelayMinutes,
      hourlyLimit,
      now = new Date(),
    }: {
      senderId: string;
      minDelayMinutes: number;
      hourlyLimit: number;
      now?: Date;
    }) {
      const minDelayMs = Math.max(0, minDelayMinutes * 60_000);
      const { windowKey, lastSentKey, windowStart, windowEnd } = getSenderRateLimitWindow(senderId, now);

      const result = await redis.eval(
        `
          local windowKey = KEYS[1]
          local lastSentKey = KEYS[2]
          local now = tonumber(ARGV[1])
          local minDelayMs = tonumber(ARGV[2])
          local hourlyLimit = tonumber(ARGV[3])
          local windowStart = tonumber(ARGV[4])
          local windowEnd = tonumber(ARGV[5])

          redis.call('ZREMRANGEBYSCORE', windowKey, '-inf', windowStart - 1)

          local lastSent = tonumber(redis.call('GET', lastSentKey) or '0')
          if lastSent > 0 and (now - lastSent) < minDelayMs then
            return { 0, 'min_delay', lastSent + minDelayMs, redis.call('ZCOUNT', windowKey, windowStart, windowEnd) }
          end

          local count = tonumber(redis.call('ZCOUNT', windowKey, windowStart, windowEnd) or '0')
          if count >= hourlyLimit then
            return { 0, 'hourly_limit', windowStart + 3600000, count }
          end

          local member = tostring(now) .. ':' .. tostring(math.random(0, 1000000000))
          redis.call('ZADD', windowKey, now, member)
          redis.call('SET', lastSentKey, now)
          return { 1, 'ok', now, count + 1 }
        `,
        2,
        windowKey,
        lastSentKey,
        String(now.getTime()),
        String(minDelayMs),
        String(hourlyLimit),
        String(windowStart),
        String(windowEnd),
      );

      const typedResult = Array.isArray(result) ? result : [0, 'unknown', 0, 0];
      const [allowed, reason, retryAtMs, currentCount] = typedResult.map((value) => Number.isFinite(Number(value)) && String(value) !== '' ? Number(value) : value);
      const normalizedReason: RateLimitDecision['reason'] = reason === 'ok' ? 'ok' : reason === 'min_delay' ? 'min_delay' : 'hourly_limit';

      return {
        allowed: allowed === 1,
        reason: normalizedReason,
        retryAtMs: typeof retryAtMs === 'number' && retryAtMs > 0 ? retryAtMs : null,
        currentCount: typeof currentCount === 'number' ? currentCount : 0,
        hourlyLimit,
        senderId,
      } satisfies RateLimitDecision;
    },
  };
}

export async function recordRateLimitEvent({
  senderId,
  emailId,
  reason,
  retryAtMs,
  redis = new Redis(env.REDIS_URL),
}: {
  senderId: string;
  emailId: string;
  reason: 'hourly_limit' | 'min_delay';
  retryAtMs: number;
  redis?: Redis;
}) {
  const key = `rate-limit:${senderId}:${emailId}:${reason}`;
  const ttlSeconds = Math.max(1, Math.ceil(Math.max(retryAtMs - Date.now(), 1) / 1000));
  return redis.set(key, '1', 'EX', ttlSeconds, 'NX');
}

export async function rescheduleRateLimitedEmail({
  queue = createEmailQueue(),
  email,
  decision,
  eventReason = decision.reason === 'ok' ? 'hourly_limit' : decision.reason,
}: {
  queue?: Queue;
  email: {
    id: string;
    scheduledFor: Date;
    recipientEmail: string;
    subject: string;
    body: string;
    senderId: string;
    userId: string;
    campaignId: string;
    delayMinutes: number;
    hourlyLimit: number;
  };
  decision: RateLimitDecision;
  eventReason?: 'hourly_limit' | 'min_delay';
}) {
  if (decision.allowed || !decision.retryAtMs) {
    return null;
  }

  const retryAt = new Date(decision.retryAtMs);
  const nextScheduledFor = new Date(Math.max(retryAt.getTime(), email.scheduledFor.getTime()));
  const retryJobId = buildEmailJobId(email.id, nextScheduledFor.toISOString());
  const existing = await queue.getJob(retryJobId);

  if (existing) {
    return { jobId: retryJobId, delayMs: 0, created: false };
  }

  const job = await queue.add(
    'send-email',
    {
      emailId: email.id,
      recipientEmail: email.recipientEmail,
      senderId: email.senderId,
      userId: email.userId,
      campaignId: email.campaignId,
      subject: email.subject,
      body: email.body,
      delayMinutes: email.delayMinutes,
      hourlyLimit: email.hourlyLimit,
    },
    {
      jobId: retryJobId,
      delay: Math.max(0, nextScheduledFor.getTime() - Date.now()),
      attempts: 3,
      backoff: { type: 'exponential', delay: 15_000 },
    },
  );

  await recordRateLimitEvent({
    senderId: email.senderId,
    emailId: email.id,
    reason: eventReason,
    retryAtMs: nextScheduledFor.getTime(),
  });

  return {
    jobId: job.id ?? retryJobId,
    delayMs: Math.max(0, nextScheduledFor.getTime() - Date.now()),
    created: true,
  };
}

export async function transitionEmailStatus({
  emailId,
  expectedStatus,
  nextStatus,
  data,
  updateMany,
}: {
  emailId: string;
  expectedStatus: string;
  nextStatus: string;
  data: Record<string, unknown>;
  updateMany: (args: { where: { id: string; status: string }; data: Record<string, unknown> }) => Promise<{ count?: number }>;
}) {
  const result = await updateMany({
    where: {
      id: emailId,
      status: expectedStatus,
    },
    data,
  });

  if (result && typeof result === 'object' && 'count' in result) {
    return Number(result.count ?? 0) > 0;
  }

  void nextStatus;
  return true;
}

export function createEmailQueue({ queueName = EMAIL_QUEUE_NAME } = {}) {
  return new Queue(queueName, {
    connection: {
      url: env.REDIS_URL,
    },
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 15_000,
      },
    },
  });
}

export async function scheduleEmailJob(
  email: {
    id: string;
    scheduledFor: Date;
    recipientEmail: string;
    subject: string;
    body: string;
    senderId: string;
    userId: string;
    campaignId: string;
    delayMinutes: number;
    hourlyLimit: number;
  },
  queueOverride?: Queue,
): Promise<{ jobId: string; delayMs: number; created: boolean }> {
  const queue = queueOverride ?? createEmailQueue();
  const delayMs = Math.max(0, email.scheduledFor.getTime() - Date.now());
  const jobId = buildEmailJobId(email.id, email.scheduledFor.toISOString());

  const existingJob = await queue.getJob(jobId);
  if (existingJob) {
    if (!queueOverride) {
      await queue.close();
    }
    return {
      jobId: existingJob.id ?? jobId,
      delayMs,
      created: false,
    };
  }

  const job = await queue.add(
    'send-email',
    {
      emailId: email.id,
      recipientEmail: email.recipientEmail,
      senderId: email.senderId,
      userId: email.userId,
      campaignId: email.campaignId,
      subject: email.subject,
      body: email.body,
      delayMinutes: email.delayMinutes,
      hourlyLimit: email.hourlyLimit,
    },
    {
      jobId,
      delay: delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 15_000 },
    },
  );

  if (!queueOverride) {
    await queue.close();
  }

  return {
    jobId: job.id ?? jobId,
    delayMs,
    created: true,
  };
}

export async function reconcileMissingJobs({
  queue = createEmailQueue(),
  findPendingEmails = async () =>
    prisma.email.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledFor: {
          gte: new Date(Date.now() - 60_000),
        },
      },
      orderBy: { scheduledFor: 'asc' },
    }),
  scheduleJob = scheduleEmailJob,
}: {
  queue?: Queue;
  findPendingEmails?: () => Promise<Array<{
    id: string;
    status: string;
    scheduledFor: Date;
    recipientEmail: string;
    subject: string;
    body: string;
    senderId: string;
    userId: string;
    campaignId: string;
    delayMinutes: number;
    hourlyLimit: number;
  }>>;
  scheduleJob?: (
    email: {
      id: string;
      scheduledFor: Date;
      recipientEmail: string;
      subject: string;
      body: string;
      senderId: string;
      userId: string;
      campaignId: string;
      delayMinutes: number;
      hourlyLimit: number;
    },
    queueOverride?: Queue,
  ) => Promise<{ jobId: string; delayMs: number; created?: boolean }>;
} = {}) {
  const emails = await findPendingEmails();
  const requeued: Array<{ emailId: string; jobId: string; created: boolean }> = [];

  for (const email of emails) {
    const jobId = buildEmailJobId(email.id, email.scheduledFor.toISOString());
    const existingJob = await queue.getJob(jobId);

    if (existingJob) {
      continue;
    }

    const scheduled = await scheduleJob(email, queue);
    requeued.push({
      emailId: email.id,
      jobId: scheduled.jobId ?? jobId,
      created: scheduled.created ?? true,
    });
  }

  return requeued;
}

type EmailJob = Pick<Job<{ emailId: string }>, 'id' | 'data'>;

export async function processEmailJob(
  job: EmailJob,
  deps: {
    findEmail: (emailId: string) => Promise<{
      id: string;
      status: string;
      recipientEmail: string;
      subject: string;
      body: string;
      attempts: number;
      senderId: string;
      userId: string;
      campaignId: string;
      scheduledFor: Date;
      sentAt: Date | null;
      delayMinutes: number;
      hourlyLimit: number;
    } | null>;
    markQueued: (emailId: string) => Promise<{ count?: number } | unknown>;
    markSent: (emailId: string, messageId: string) => Promise<{ count?: number } | unknown>;
    markFailed: (emailId: string, reason: string, attempts: number) => Promise<{ count?: number } | unknown>;
    sendEmail: (args: { to: string; subject: string; body: string; from?: string }) => Promise<{ messageId: string; previewUrl?: string | false | null }>;
  } = {
    findEmail: async (emailId) => prisma.email.findUnique({ where: { id: emailId } }),
    markQueued: async (emailId) =>
      prisma.email.updateMany({
        where: { id: emailId, status: 'SCHEDULED' },
        data: { status: 'QUEUED', attempts: { increment: 1 } },
      }),
    markSent: async (emailId, messageId) =>
      prisma.email.updateMany({
        where: { id: emailId, status: 'QUEUED' },
        data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 0 } },
      }),
    markFailed: async (emailId, reason, attempts) =>
      prisma.email.updateMany({
        where: { id: emailId, status: { in: ['SCHEDULED', 'QUEUED'] } },
        data: { status: 'FAILED', attempts },
      }),
    sendEmail: sendEmailMessage,
  },
) {
  const email = await deps.findEmail(job.data.emailId);

  if (!email) {
    return { status: 'failed', reason: 'not_found', attempts: 0 };
  }

  if (shouldSkipEmailProcessing(email)) {
    return { status: 'skipped', attempts: email.attempts, reason: 'duplicate-or-complete' };
  }

  try {
    const queuedResult = await deps.markQueued(email.id);
    const queuedCount = queuedResult && typeof queuedResult === 'object' && 'count' in queuedResult ? Number(queuedResult.count ?? 0) : 1;

    if (queuedCount === 0) {
      return { status: 'skipped', attempts: email.attempts, reason: 'duplicate-or-complete' };
    }

    await indexEmailRecord({
      email: {
        id: email.id,
        userId: email.userId,
        senderId: email.senderId,
        recipientEmail: email.recipientEmail,
        subject: email.subject,
        body: email.body,
        status: 'QUEUED',
        scheduledFor: email.scheduledFor,
        sentAt: email.sentAt,
        createdAt: new Date(),
      },
    }).catch(() => undefined);

    const rateLimiter = createSenderRateLimiter();
    const decision: RateLimitDecision = await rateLimiter.reserveSendSlot({
      senderId: email.senderId,
      minDelayMinutes: email.delayMinutes,
      hourlyLimit: email.hourlyLimit,
      now: new Date(),
    });

    if (!decision.allowed) {
      const nextScheduledFor = new Date(decision.retryAtMs ?? Date.now() + 60_000);

      await prisma.email.update({
        where: { id: email.id },
        data: {
          status: 'SCHEDULED',
          scheduledFor: nextScheduledFor,
        },
      });

      await indexEmailRecord({
        email: {
          id: email.id,
          userId: email.userId,
          senderId: email.senderId,
          recipientEmail: email.recipientEmail,
          subject: email.subject,
          body: email.body,
          status: 'SCHEDULED',
          scheduledFor: nextScheduledFor,
          sentAt: email.sentAt,
          createdAt: new Date(),
        },
      }).catch(() => undefined);

      const queued = await rescheduleRateLimitedEmail({
        email: {
          id: email.id,
          scheduledFor: email.scheduledFor,
          recipientEmail: email.recipientEmail,
          subject: email.subject,
          body: email.body,
          senderId: email.senderId,
          userId: email.userId,
          campaignId: email.campaignId,
          delayMinutes: email.delayMinutes,
          hourlyLimit: email.hourlyLimit,
        },
        decision,
      });

      void sendRateLimitSlackNotification({
        userId: email.userId,
        senderId: email.senderId,
        emailId: email.id,
        reason: decision.reason === 'ok' ? 'hourly_limit' : decision.reason,
        retryAtMs: decision.retryAtMs ?? Date.now() + 60_000,
        redis: new Redis(env.REDIS_URL),
      }).catch((error) => {
        console.warn('Slack rate-limit notification skipped:', error);
      });

      return {
        status: 'rescheduled',
        reason: decision.reason,
        retryAtMs: decision.retryAtMs,
        jobId: queued?.jobId ?? null,
      };
    }

    const result = await deps.sendEmail({
      to: email.recipientEmail,
      subject: email.subject,
      body: email.body,
      from: env.EMAIL_FROM,
    });

    const sentResult = await deps.markSent(email.id, result.messageId);
    const sentCount = sentResult && typeof sentResult === 'object' && 'count' in sentResult ? Number(sentResult.count ?? 0) : 1;

    if (sentCount === 0) {
      throw new Error(`Email ${email.id} was already processed and could not be marked as sent.`);
    }

    await indexEmailRecord({
      email: {
        id: email.id,
        userId: email.userId,
        senderId: email.senderId,
        recipientEmail: email.recipientEmail,
        subject: email.subject,
        body: email.body,
        status: 'SENT',
        scheduledFor: email.scheduledFor,
        sentAt: new Date(),
        createdAt: new Date(),
      },
    }).catch(() => undefined);

    return {
      status: 'sent',
      messageId: result.messageId,
      attempts: email.attempts + 1,
    };
  } catch (error) {
    const nextAttempt = email.attempts + 1;
    const failed = await deps.markFailed(email.id, error instanceof Error ? error.message : 'unknown_error', nextAttempt);
    const failedCount = failed && typeof failed === 'object' && 'count' in failed ? Number(failed.count ?? 0) : 1;

    if (failedCount === 0) {
      console.warn(`Email ${email.id} failed to transition to FAILED after an error, but it may already be processed.`);
    }

    await indexEmailRecord({
      email: {
        id: email.id,
        userId: email.userId,
        senderId: email.senderId,
        recipientEmail: email.recipientEmail,
        subject: email.subject,
        body: email.body,
        status: 'FAILED',
        scheduledFor: email.scheduledFor,
        sentAt: email.sentAt,
        createdAt: new Date(),
      },
    }).catch(() => undefined);

    throw error;
  }
}

export function createEmailWorker({ queueName = EMAIL_QUEUE_NAME, concurrency = env.WORKER_CONCURRENCY } = {}) {
  const worker = new Worker(
    queueName,
    async (job) => processEmailJob(job),
    {
      connection: {
        url: env.REDIS_URL,
      },
      concurrency,
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 1000 },
    },
  );

  worker.on('completed', async (job) => {
    console.log(`Email job ${job.id} completed for ${job.data.emailId}`);
  });

  worker.on('failed', async (job, error) => {
    console.error(`Email job ${job?.id} failed for ${job?.data.emailId}:`, error.message);
  });

  return worker;
}

export async function gracefulShutdown(worker: Worker, additionalQueues: Queue[] = []) {
  console.log('Shutting down email worker...');
  await worker.close();

  await Promise.all(
    additionalQueues.map(async (queue) => {
      try {
        await queue.close();
      } catch (error) {
        console.warn('Queue shutdown warning:', error);
      }
    }),
  );
}
