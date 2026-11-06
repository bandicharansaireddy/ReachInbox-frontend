import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../lib/prisma.ts';
import { requireAuth } from './authRoutes.ts';

const senderPayloadSchema = z.object({
  displayName: z.string().trim().min(1, 'displayName is required').max(100, 'displayName is too long'),
  emailAddress: z.string().trim().email('A valid sender email is required'),
});

const senderRoutes = Router();

senderRoutes.get('/', requireAuth, async (req: any, res) => {
  const userId = req.user?.sub ?? req.user?.id ?? '';

  if (!userId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const senders = await prisma.sender.findMany({
      where: { userId },
      orderBy: [{ displayName: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        displayName: true,
        emailAddress: true,
        status: true,
      },
    });

    return res.json({ senders });
  } catch (error) {
    console.error('Failed to load senders:', error);
    return res.status(500).json({ error: 'Unable to load senders.' });
  }
});

senderRoutes.post('/', requireAuth, async (req: any, res) => {
  const userId = req.user?.sub ?? req.user?.id ?? '';

  if (!userId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const parseResult = senderPayloadSchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Sender validation failed',
      details: parseResult.error.flatten(),
    });
  }

  try {
    const emailAddress = parseResult.data.emailAddress.trim().toLowerCase();
    const displayName = parseResult.data.displayName.trim();

    const sender = await prisma.sender.upsert({
      where: {
        userId_emailAddress: {
          userId,
          emailAddress,
        },
      },
      update: {
        displayName,
      },
      create: {
        userId,
        displayName,
        emailAddress,
      },
      select: {
        id: true,
        displayName: true,
        emailAddress: true,
        status: true,
      },
    });

    return res.status(201).json({
      message: 'Sender saved successfully.',
      sender,
    });
  } catch (error) {
    console.error('Failed to save sender:', error);
    return res.status(500).json({ error: 'Unable to save sender.' });
  }
});

export default senderRoutes;
