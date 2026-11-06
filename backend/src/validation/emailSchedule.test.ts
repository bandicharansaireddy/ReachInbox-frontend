import { describe, expect, it } from 'vitest';

import {
  calculateRecipientSchedules,
  deduplicateRecipients,
  scheduleEmailRequestSchema,
} from './emailSchedule.js';

describe('scheduleEmailRequestSchema', () => {
  it('accepts a valid schedule request', () => {
    const parsed = scheduleEmailRequestSchema.safeParse({
      senderId: 'sender_123',
      recipients: ['alpha@example.com', 'beta@example.com'],
      subject: 'Quarterly update',
      body: 'Hello team, this is a planned update.',
      startTime: '2026-11-10T12:00:00.000Z',
      delayMinutes: 15,
      hourlyLimit: 50,
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects invalid emails and negative limits', () => {
    const parsed = scheduleEmailRequestSchema.safeParse({
      senderId: 'sender_123',
      recipients: ['not-an-email', 'beta@example.com'],
      subject: '',
      body: '',
      startTime: '2026-11-10T12:00:00.000Z',
      delayMinutes: -5,
      hourlyLimit: 0,
    });

    expect(parsed.success).toBe(false);
  });
});

describe('recipient scheduling helpers', () => {
  it('deduplicates recipients while preserving order', () => {
    const result = deduplicateRecipients([
      ' nick@example.com ',
      'nick@example.com',
      'mary@example.com',
      'mary@example.com',
    ]);

    expect(result).toEqual(['nick@example.com', 'mary@example.com']);
  });

  it('calculates delayed delivery times per recipient', () => {
    const startTime = new Date('2026-11-10T12:00:00.000Z');
    const result = calculateRecipientSchedules(startTime, 30, [
      'alpha@example.com',
      'beta@example.com',
      'gamma@example.com',
    ]);

    expect(result).toEqual([
      { recipient: 'alpha@example.com', scheduledFor: new Date('2026-11-10T12:00:00.000Z') },
      { recipient: 'beta@example.com', scheduledFor: new Date('2026-11-10T12:30:00.000Z') },
      { recipient: 'gamma@example.com', scheduledFor: new Date('2026-11-10T13:00:00.000Z') },
    ]);
  });
});
