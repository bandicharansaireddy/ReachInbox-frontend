import { afterEach, describe, expect, it } from 'vitest';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import {
  buildEmailJobId,
  createEmailQueue,
  createSenderRateLimiter,
  getRetryDelay,
  processEmailJob,
  reconcileMissingJobs,
  rescheduleRateLimitedEmail,
  shouldSkipEmailProcessing,
  transitionEmailStatus,
} from './emailQueue.js';

describe('BullMQ email queue', () => {
  const queues: Queue[] = [];

  afterEach(async () => {
    await Promise.all(queues.map((queue) => queue.close()));
    queues.length = 0;
  });

  it('creates a queue and schedules a delayed job with a deterministic ID', async () => {
    const queue = createEmailQueue({ queueName: 'phase3-test-queue' });
    queues.push(queue);

    const jobId = buildEmailJobId('email-42', '2026-11-20T12:00:00.000Z');
    const job = await queue.add(
      'send-email',
      { emailId: 'email-42', recipientEmail: 'alpha@example.com' },
      { delay: 1_000, jobId },
    );

    expect(job.id).toBe(jobId);
    const stored = await queue.getJob(jobId);
    expect(stored?.data.emailId).toBe('email-42');
  });

  it('reuses the same deterministic job ID to prevent duplicate queue entries', async () => {
    const queue = createEmailQueue({ queueName: 'phase3-test-duplicate' });
    queues.push(queue);

    const jobId = buildEmailJobId('email-99', '2026-11-20T13:00:00.000Z');
    const firstJob = await queue.add('send-email', { emailId: 'email-99' }, { jobId });
    const duplicateJob = await queue.add('send-email', { emailId: 'email-99', recipientEmail: 'same@example.com' }, { jobId });

    expect(firstJob.id).toBe(jobId);
    expect(duplicateJob.id).toBe(jobId);

    const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
    const matchingJobs = jobs.filter((job) => job.id === jobId);
    expect(matchingJobs).toHaveLength(1);
  });

  it('skips already-processed records and calculates retry backoff', () => {
    expect(shouldSkipEmailProcessing({ status: 'SENT' })).toBe(true);
    expect(shouldSkipEmailProcessing({ status: 'QUEUED' })).toBe(true);
    expect(shouldSkipEmailProcessing({ status: 'SCHEDULED' })).toBe(false);
    expect(getRetryDelay(1)).toBeGreaterThan(0);
    expect(getRetryDelay(3)).toBeGreaterThan(getRetryDelay(2));
  });

  it('reconciles missing queue jobs after restart and only re-enqueues the missing ones', async () => {
    const queue = createEmailQueue({ queueName: 'phase4-recovery' });
    queues.push(queue);

    const pendingEmails = [
      {
        id: 'email-recovery-1',
        status: 'SCHEDULED',
        recipientEmail: 'recover-one@example.com',
        subject: 'Recovery test',
        body: 'Body',
        senderId: 'sender-1',
        userId: 'user-1',
        campaignId: 'campaign-1',
        attempts: 0,
        scheduledFor: new Date(Date.now() + 60_000),
        sentAt: null,
        delayMinutes: 15,
        hourlyLimit: 20,
      },
      {
        id: 'email-recovery-2',
        status: 'SCHEDULED',
        recipientEmail: 'recover-two@example.com',
        subject: 'Recovery test',
        body: 'Body',
        senderId: 'sender-1',
        userId: 'user-1',
        campaignId: 'campaign-1',
        attempts: 0,
        scheduledFor: new Date(Date.now() + 60_000),
        sentAt: null,
        delayMinutes: 15,
        hourlyLimit: 20,
      },
    ];

    await queue.add('send-email', { emailId: 'email-recovery-2' }, { jobId: buildEmailJobId('email-recovery-2', pendingEmails[1].scheduledFor.toISOString()) });

    const scheduled: string[] = [];
    const result = await reconcileMissingJobs({
      queue,
      findPendingEmails: async () => pendingEmails,
      scheduleJob: async (email) => {
        scheduled.push(email.id);
        return {
          jobId: buildEmailJobId(email.id, email.scheduledFor.toISOString()),
          delayMs: 60_000,
        };
      },
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.emailId).toBe('email-recovery-1');
    expect(scheduled).toEqual(['email-recovery-1']);
  });

  it('does not process an email that is already queued or sent', async () => {
    const queuedRecord = {
      id: 'email-queued-duplicate',
      status: 'QUEUED',
      recipientEmail: 'duplicate@example.com',
      subject: 'Will not send',
      body: 'Body',
      senderId: 'sender-1',
      userId: 'user-1',
      campaignId: 'campaign-1',
      attempts: 1,
      scheduledFor: new Date('2026-11-20T12:00:00.000Z'),
      sentAt: null,
      delayMinutes: 15,
      hourlyLimit: 20,
    };

    const result = await processEmailJob(
      { id: 'job-duplicate', data: { emailId: 'email-queued-duplicate' } },
      {
        findEmail: async () => queuedRecord,
        markQueued: async () => ({ count: 1 }),
        markSent: async () => ({ count: 1 }),
        markFailed: async () => ({ count: 1 }),
        sendEmail: async () => ({ messageId: 'should-not-send' }),
      },
    );

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('duplicate-or-complete');
  });

  it('only allows valid status transitions for email processing', async () => {
    const queued = await transitionEmailStatus({
      emailId: 'email-status-guard',
      expectedStatus: 'SCHEDULED',
      nextStatus: 'QUEUED',
      data: { status: 'QUEUED', attempts: 1 },
      updateMany: async () => ({ count: 1 }),
    });

    const blocked = await transitionEmailStatus({
      emailId: 'email-status-guard',
      expectedStatus: 'SCHEDULED',
      nextStatus: 'QUEUED',
      data: { status: 'QUEUED', attempts: 1 },
      updateMany: async () => ({ count: 0 }),
    });

    expect(queued).toBe(true);
    expect(blocked).toBe(false);
  });

  it('enforces the sender minimum delay and hourly limit with redis coordination', async () => {
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    await redis.flushdb();

    const limiter = createSenderRateLimiter({ redis });

    const first = await limiter.reserveSendSlot({ senderId: 'sender-rate-limit', minDelayMinutes: 5, hourlyLimit: 2, now: new Date('2026-11-05T12:00:00.000Z') });
    const second = await limiter.reserveSendSlot({ senderId: 'sender-rate-limit', minDelayMinutes: 5, hourlyLimit: 2, now: new Date('2026-11-05T12:00:00.000Z') });
    const recovery = await limiter.reserveSendSlot({ senderId: 'sender-rate-limit', minDelayMinutes: 0, hourlyLimit: 1, now: new Date('2026-11-05T13:00:00.000Z') });

    expect(first.allowed).toBe(true);
    expect(second.reason).toBe('min_delay');
    expect(second.retryAtMs).not.toBeNull();
    expect(recovery.allowed).toBe(true);

    await redis.quit();
  });

  it('coordinates rate limits across multiple worker instances using Redis atomics', async () => {
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    await redis.flushdb();

    const firstWorker = createSenderRateLimiter({ redis });
    const secondWorker = createSenderRateLimiter({ redis });

    const [first, second] = await Promise.all([
      firstWorker.reserveSendSlot({ senderId: 'sender-multi-worker', minDelayMinutes: 0, hourlyLimit: 1, now: new Date('2026-11-05T13:00:00.000Z') }),
      secondWorker.reserveSendSlot({ senderId: 'sender-multi-worker', minDelayMinutes: 0, hourlyLimit: 1, now: new Date('2026-11-05T13:00:00.000Z') }),
    ]);

    expect([first.allowed, second.allowed].filter(Boolean)).toHaveLength(1);
    await redis.quit();
  });

  it('reschedules a rate-limited job instead of dropping it', async () => {
    const queue = createEmailQueue({ queueName: 'phase5-reschedule' });
    queues.push(queue);

    const result = await rescheduleRateLimitedEmail({
      queue,
      email: {
        id: 'email-rate-limit-1',
        scheduledFor: new Date('2026-11-05T12:00:00.000Z'),
        recipientEmail: 'rate-limit@example.com',
        subject: 'Rate limit test',
        body: 'Try again later',
        senderId: 'sender-rate-limit',
        userId: 'user-1',
        campaignId: 'campaign-1',
        delayMinutes: 5,
        hourlyLimit: 1,
      },
      decision: {
        allowed: false,
        reason: 'hourly_limit',
        retryAtMs: Date.now() + 60_000,
        currentCount: 1,
        hourlyLimit: 1,
        senderId: 'sender-rate-limit',
      },
    });

    expect(result?.created).toBe(true);
    expect(result?.jobId).toBeTruthy();

    const stored = await queue.getJob(result!.jobId);
    expect(stored?.data.emailId).toBe('email-rate-limit-1');
  });

  it('processes a scheduled email, marks it sent, and handles retry state', async () => {
    const emailRecord = {
      id: 'email-123',
      status: 'SCHEDULED',
      recipientEmail: 'worker@example.com',
      subject: 'Phase 3 test',
      body: 'Email body',
      senderId: 'sender-1',
      userId: 'user-1',
      campaignId: 'campaign-1',
      attempts: 0,
      scheduledFor: new Date('2026-11-20T12:00:00.000Z'),
      sentAt: null,
      delayMinutes: 15,
      hourlyLimit: 50,
    };

    const result = await processEmailJob(
      { id: 'job-123', data: { emailId: 'email-123' } },
      {
        findEmail: async () => emailRecord,
        markQueued: async () => ({ ...emailRecord, status: 'QUEUED' }),
        markSent: async () => ({ ...emailRecord, status: 'SENT', sentAt: new Date() }),
        markFailed: async () => ({ ...emailRecord, status: 'FAILED' }),
        sendEmail: async () => ({ messageId: 'test-message-id' }),
      },
    );

    expect(result.status).toBe('sent');
    expect(result.messageId).toBe('test-message-id');
    expect(result.attempts).toBe(1);
  });
});
