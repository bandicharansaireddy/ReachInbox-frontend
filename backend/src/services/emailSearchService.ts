import { Client } from '@elastic/elasticsearch';
import { Redis } from 'ioredis';

import { env } from '../config/env.ts';

export const EMAIL_SEARCH_INDEX = 'reachinbox-emails';
export const EMAIL_INDEX_RETRY_QUEUE = 'email-index:retry';

export type EmailSearchDocument = {
  id: string;
  userId: string;
  senderId: string;
  senderName?: string | null;
  recipientEmail: string;
  subject: string;
  body: string;
  status: string;
  scheduledFor: string;
  sentAt?: string | null;
  createdAt: string;
};

export function createEmailSearchClient({
  node = env.ELASTICSEARCH_URL,
  apiKey = env.ELASTICSEARCH_API_KEY,
} = {}) {
  return new Client({ node, ...(apiKey ? { auth: { apiKey } } : {}) });
}

export function serializeEmailForIndex(email: {
  id: string;
  userId: string;
  senderId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: string;
  scheduledFor: Date | string;
  sentAt?: Date | string | null;
  createdAt?: Date | string;
  senderName?: string | null;
}): EmailSearchDocument {
  return {
    id: email.id,
    userId: email.userId,
    senderId: email.senderId,
    senderName: email.senderName ?? null,
    recipientEmail: email.recipientEmail,
    subject: email.subject,
    body: email.body,
    status: email.status,
    scheduledFor: new Date(email.scheduledFor).toISOString(),
    sentAt: email.sentAt ? new Date(email.sentAt).toISOString() : null,
    createdAt: email.createdAt ? new Date(email.createdAt).toISOString() : new Date().toISOString(),
  };
}

export async function ensureEmailSearchIndex(client: Client = createEmailSearchClient()) {
  try {
    const exists = await client.indices.exists({ index: EMAIL_SEARCH_INDEX });
    if (exists) {
      return true;
    }

    await client.indices.create({
      index: EMAIL_SEARCH_INDEX,
      mappings: {
        properties: {
          id: { type: 'keyword' },
          userId: { type: 'keyword' },
          senderId: { type: 'keyword' },
          senderName: { type: 'text' },
          recipientEmail: { type: 'text' },
          subject: { type: 'text' },
          body: { type: 'text' },
          status: { type: 'keyword' },
          scheduledFor: { type: 'date' },
          sentAt: { type: 'date' },
          createdAt: { type: 'date' },
        },
      },
    });

    return true;
  } catch (_error) {
    return false;
  }
}

export async function indexEmailRecord({
  email,
  client = createEmailSearchClient(),
  redis = new Redis(env.REDIS_URL),
  queueKey = EMAIL_INDEX_RETRY_QUEUE,
}: {
  email: {
    id: string;
    userId: string;
    senderId: string;
    recipientEmail: string;
    subject: string;
    body: string;
    status: string;
    scheduledFor: Date | string;
    sentAt?: Date | string | null;
    createdAt?: Date | string;
    senderName?: string | null;
  };
  client?: Client;
  redis?: Redis;
  queueKey?: string;
}) {
  try {
    await ensureEmailSearchIndex(client);
    await client.index({
      index: EMAIL_SEARCH_INDEX,
      id: email.id,
      document: serializeEmailForIndex(email),
      refresh: 'wait_for',
    });

    return { ok: true };
  } catch (error) {
    const payload = JSON.stringify({
      ...serializeEmailForIndex(email),
      error: error instanceof Error ? error.message : 'unknown indexing error',
      retryAt: new Date().toISOString(),
    });

    try {
      await redis.lpush(queueKey, payload);
    } catch (_redisError) {
      // Indexing failures must never interrupt email sending; this is safe to ignore.
    }

    return {
      ok: false,
      queued: true,
      error: error instanceof Error ? error.message : 'unknown indexing error',
    };
  }
}

export async function retryQueuedEmailIndexEntries({
  client = createEmailSearchClient(),
  redis = new Redis(env.REDIS_URL),
  queueKey = EMAIL_INDEX_RETRY_QUEUE,
  limit = 20,
}: {
  client?: Client;
  redis?: Redis;
  queueKey?: string;
  limit?: number;
} = {}) {
  try {
    const queued = await redis.lrange(queueKey, 0, limit - 1);

    for (const entry of queued) {
      try {
        const parsed = JSON.parse(entry) as { id?: string; userId?: string; senderId?: string; recipientEmail?: string; subject?: string; body?: string; status?: string; scheduledFor?: string; sentAt?: string | null; createdAt?: string; senderName?: string | null };
        if (!parsed.id) {
          continue;
        }

        await indexEmailRecord({ email: {
          id: parsed.id,
          userId: parsed.userId ?? 'unknown',
          senderId: parsed.senderId ?? 'unknown',
          recipientEmail: parsed.recipientEmail ?? '',
          subject: parsed.subject ?? '',
          body: parsed.body ?? '',
          status: parsed.status ?? 'SCHEDULED',
          scheduledFor: parsed.scheduledFor ?? new Date().toISOString(),
          sentAt: parsed.sentAt ?? null,
          createdAt: parsed.createdAt ?? new Date().toISOString(),
          senderName: parsed.senderName ?? null,
        }, client, redis, queueKey });

        await redis.lrem(queueKey, 1, entry);
      } catch (_error) {
        continue;
      }
    }

    return { ok: true, retried: queued.length };
  } catch (_error) {
    return { ok: false, retried: 0 };
  }
}

export async function searchEmails({
  query,
  userId,
  client = createEmailSearchClient(),
}: {
  query: string;
  userId: string;
  client?: Client;
}) {
  const trimmed = query.trim();

  if (!trimmed || !userId) {
    return [] as EmailSearchDocument[];
  }

  try {
    const result = await client.search({
      index: EMAIL_SEARCH_INDEX,
      size: 50,
      sort: [{ scheduledFor: 'desc' }],
      query: {
        bool: {
          filter: [{ term: { userId } }],
          must: [
            {
              multi_match: {
                query: trimmed,
                fields: ['recipientEmail', 'subject', 'body', 'senderId', 'senderName'],
                type: 'best_fields',
                fuzziness: 'AUTO',
              },
            },
          ],
        },
      },
    });

    return ((result.hits?.hits ?? []) as Array<{ _source?: EmailSearchDocument }>).map((hit) => hit._source).filter(Boolean) as EmailSearchDocument[];
  } catch (_error) {
    return [] as EmailSearchDocument[];
  }
}
