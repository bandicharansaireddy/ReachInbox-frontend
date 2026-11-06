import { Router } from 'express';

import { requireAuth } from './authRoutes.ts';
import { prisma } from '../lib/prisma.ts';
import { scheduleEmailJob } from '../queue/emailQueue.ts';
import { indexEmailRecord, searchEmails } from '../services/emailSearchService.ts';
import {
  calculateRecipientSchedules,
  deduplicateRecipients,
  scheduleEmailRequestSchema,
} from '../validation/emailSchedule.ts';

const emailRoutes = Router();

function normalizeEmailStatus(value: string | undefined, fallback: 'SCHEDULED' | 'SENT' = 'SCHEDULED') {
  const normalized = (value ?? '').toUpperCase();
  if (normalized === 'SENT' || normalized === 'SCHEDULED') {
    return normalized;
  }
  return fallback;
}

emailRoutes.get('/', requireAuth, async (req: any, res) => {
  const userId = req.user?.sub ?? req.user?.id ?? '';
  const status = normalizeEmailStatus(typeof req.query.status === 'string' ? req.query.status : undefined, 'SCHEDULED');
  const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  if (!userId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const emails = await prisma.email.findMany({
      where: {
        userId,
        status: status === 'SENT' ? { in: ['SENT', 'FAILED'] } : 'SCHEDULED',
        ...(search ? {
          OR: [
            { recipientEmail: { contains: search, mode: 'insensitive' } },
            { subject: { contains: search, mode: 'insensitive' } },
            { body: { contains: search, mode: 'insensitive' } },
          ],
        } : {}),
      },
      include: {
        sender: {
          select: {
            id: true,
            displayName: true,
            emailAddress: true,
          },
        },
      },
      orderBy: [{ scheduledFor: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });

    return res.json({
      emails: emails.map((email) => ({
        id: email.id,
        recipientEmail: email.recipientEmail,
        subject: email.subject,
        body: email.body,
        status: email.status,
        scheduledFor: email.scheduledFor.toISOString(),
        sentAt: email.sentAt ? email.sentAt.toISOString() : null,
        createdAt: email.createdAt.toISOString(),
        updatedAt: email.updatedAt.toISOString(),
        sender: email.sender
          ? {
            id: email.sender.id,
            displayName: email.sender.displayName,
            emailAddress: email.sender.emailAddress,
          }
          : null,
      })),
      total: emails.length,
    });
  } catch (error) {
    console.error('Failed to load dashboard emails:', error);
    return res.status(500).json({ error: 'Unable to load emails for this dashboard.' });
  }
});

emailRoutes.get('/search', requireAuth, async (req: any, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const userId = req.user?.sub ?? req.user?.id ?? '';

  if (!query) {
    return res.status(400).json({ error: 'A search query is required.' });
  }

  if (!userId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const results = await searchEmails({ query, userId });
    return res.json({
      query,
      userId,
      total: results.length,
      results,
    });
  } catch (_error) {
    return res.status(503).json({
      error: 'Email search is temporarily unavailable.',
    });
  }
});

emailRoutes.post('/schedule', requireAuth, async (req: any, res) => {
  const userId = req.user?.sub ?? req.user?.id ?? '';

  if (!userId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const parseResult = scheduleEmailRequestSchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Schedule request validation failed',
      details: parseResult.error.flatten(),
    });
  }

  const { senderId, recipients, subject, body, startTime, delayMinutes, hourlyLimit } = parseResult.data;

  try {
    const sender = await prisma.sender.findUnique({
      where: { id: senderId },
    });

    if (!sender) {
      return res.status(404).json({
        error: 'Sender not found',
        message: 'The provided senderId does not exist.',
      });
    }

    if (sender.userId !== userId) {
      return res.status(403).json({
        error: 'Sender access denied',
        message: 'This sender belongs to a different account.',
      });
    }

    const normalizedRecipients = deduplicateRecipients(recipients);

    if (normalizedRecipients.length === 0) {
      return res.status(400).json({
        error: 'No valid recipients were provided',
        message: 'At least one valid recipient email address is required.',
      });
    }

    const campaign = await prisma.campaign.create({
      data: {
        userId: sender.userId,
        senderId: sender.id,
        name: `Campaign ${new Date(startTime).toISOString()}`,
        subject,
        body,
        status: 'DRAFT',
      },
    });

    const scheduledPlans = calculateRecipientSchedules(startTime, delayMinutes, normalizedRecipients);

    const createdEmails = await Promise.all(
      scheduledPlans.map((item) =>
        prisma.email.create({
          data: {
            campaignId: campaign.id,
            userId: sender.userId,
            senderId: sender.id,
            recipientEmail: item.recipient,
            subject,
            body,
            scheduledFor: item.scheduledFor,
            delayMinutes,
            hourlyLimit,
            status: 'SCHEDULED',
          },
        }),
      ),
    );

    const queuedJobs = await Promise.all(createdEmails.map((email) => scheduleEmailJob(email)));

    await Promise.all(
      createdEmails.map((email) =>
        indexEmailRecord({
          email: {
            ...email,
            status: 'SCHEDULED',
            senderName: sender.displayName,
          },
        }).catch(() => undefined),
      ),
    );

    return res.status(201).json({
      message: 'Emails scheduled successfully',
      campaignId: campaign.id,
      totalRecipients: createdEmails.length,
      queuedJobs,
      scheduledEmails: createdEmails.map((email) => ({
        id: email.id,
        recipientEmail: email.recipientEmail,
        scheduledFor: email.scheduledFor.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Failed to create scheduled emails:', error);
    return res.status(500).json({
      error: 'Unable to schedule emails',
      message: 'The schedule request could not be saved. Please try again.',
    });
  }
});

export default emailRoutes;
