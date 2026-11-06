import { z } from 'zod';

export function deduplicateRecipients(recipients: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const recipient of recipients) {
    const normalized = recipient.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    unique.push(normalized);
  }

  return unique;
}

export function calculateRecipientSchedules(
  startTime: Date,
  delayMinutes: number,
  recipients: string[],
): Array<{ recipient: string; scheduledFor: Date }> {
  const safeDelayMinutes = Number.isFinite(delayMinutes) ? Math.max(0, Math.floor(delayMinutes)) : 0;

  return recipients.map((recipient, index) => ({
    recipient,
    scheduledFor: new Date(startTime.getTime() + index * safeDelayMinutes * 60_000),
  }));
}

export const scheduleEmailRequestSchema = z
  .object({
    senderId: z.string().trim().min(1, 'senderId is required'),
    recipients: z
      .array(z.string().trim().email('Each recipient must be a valid email address'))
      .min(1, 'At least one recipient is required')
      .max(500, 'A maximum of 500 recipients is supported at once')
      .transform((values) => deduplicateRecipients(values)),
    subject: z.string().trim().min(1, 'subject is required').max(200, 'subject is too long'),
    body: z.string().trim().min(1, 'body is required').max(20000, 'body is too long'),
    startTime: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), 'startTime must be a valid ISO-8601 date string')
      .transform((value) => new Date(value))
      .refine((date) => !Number.isNaN(date.getTime()), 'startTime must be a valid date')
      .refine((date) => date.getTime() > Date.now(), 'startTime must be in the future'),
    delayMinutes: z.coerce.number().int('delayMinutes must be an integer').min(0, 'delayMinutes cannot be negative').max(1440, 'delayMinutes is too large'),
    hourlyLimit: z.coerce.number().int('hourlyLimit must be an integer').min(1, 'hourlyLimit must be at least 1').max(1000, 'hourlyLimit is too large'),
  })
  .transform((value) => ({
    ...value,
    recipients: deduplicateRecipients(value.recipients),
  }));
