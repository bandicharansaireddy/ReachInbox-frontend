import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { indexEmailRecord, searchEmails } from './emailSearchService.js';

describe('email search service', () => {
  it('keeps the Elasticsearch client on the compatible 8.x major version for the running cluster', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')) as {
      dependencies?: Record<string, string>;
    };
    const version = packageJson.dependencies?.['@elastic/elasticsearch'];

    expect(version).toBeDefined();
    expect(version).toMatch(/^\^?8\./);
  });

  it('searches only within the requesting user and filters searchable fields', async () => {
    const client = {
      search: vi.fn().mockResolvedValue({
        hits: {
          hits: [
            {
              _source: {
                id: 'email-1',
                userId: 'user-1',
                recipientEmail: 'alpha@example.com',
                subject: 'Quarterly report',
                body: 'See the details inside',
                senderId: 'sender-1',
                senderName: 'Marketing',
              },
            },
          ],
        },
      }),
    };

    const results = await searchEmails({
      query: 'quarterly',
      userId: 'user-1',
      client: client as any,
    });

    expect(client.search).toHaveBeenCalledOnce();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: 'email-1',
      userId: 'user-1',
      recipientEmail: 'alpha@example.com',
    });
  });

  it('stores failed indexing attempts for later retry instead of crashing the sender flow', async () => {
    const client = {
      index: vi.fn().mockRejectedValue(new Error('Elasticsearch unavailable')),
    };
    const redis = {
      lpush: vi.fn().mockResolvedValue(1),
    };

    const result = await indexEmailRecord({
      email: {
        id: 'email-88',
        userId: 'user-1',
        senderId: 'sender-7',
        recipientEmail: 'retry@example.com',
        subject: 'Retry test',
        body: 'Body',
        scheduledFor: new Date('2026-11-06T09:00:00.000Z'),
        status: 'SCHEDULED',
        sentAt: null,
        createdAt: new Date('2026-11-05T09:00:00.000Z'),
      },
      client: client as any,
      redis: redis as any,
    });

    expect(result.ok).toBe(false);
    expect(redis.lpush).toHaveBeenCalledWith('email-index:retry', expect.any(String));
  });
});
