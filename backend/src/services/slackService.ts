import type { Redis } from 'ioredis';

import { env } from '../config/env.ts';
import { prisma } from '../lib/prisma.ts';

export type SlackConnectionRecord = {
  userId: string;
  teamId?: string | null;
  slackUserId?: string | null;
  accessToken?: string | null;
};

export function buildSlackAuthUrl({
  userId,
  clientId = env.SLACK_CLIENT_ID,
  redirectUri = env.SLACK_REDIRECT_URI,
}: {
  userId: string;
  clientId?: string;
  redirectUri?: string;
}) {
  if (!clientId) {
    throw new Error('SLACK_CLIENT_ID is not configured.');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'chat:write',
    redirect_uri: redirectUri ?? 'http://localhost:4000/api/slack/oauth/callback',
    state: userId,
  });

  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export async function exchangeSlackCodeForToken({
  code,
  clientId = env.SLACK_CLIENT_ID,
  clientSecret = env.SLACK_CLIENT_SECRET,
  redirectUri = env.SLACK_REDIRECT_URI,
}: {
  code: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
}) {
  if (!clientId || !clientSecret) {
    throw new Error('Slack OAuth credentials are not configured.');
  }

  const response = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri ?? 'http://localhost:4000/api/slack/oauth/callback',
    }).toString(),
  });

  const payload = (await response.json()) as {
    ok?: boolean;
    error?: string;
    access_token?: string;
    team?: { id?: string | null };
    authed_user?: { id?: string | null };
    user?: { id?: string | null };
  };

  if (!response.ok || payload.ok === false || !payload.access_token) {
    throw new Error(payload.error ?? 'Slack token exchange failed.');
  }

  return payload;
}

export async function getSlackConnectionByUserId(userId: string): Promise<SlackConnectionRecord | null> {
  const connection = await prisma.slackConnection.findUnique({
    where: { userId },
    select: {
      userId: true,
      teamId: true,
      slackUserId: true,
      accessToken: true,
    },
  });

  if (!connection) {
    return null;
  }

  return connection;
}

export async function sendRateLimitSlackNotification({
  userId,
  senderId,
  emailId,
  reason,
  retryAtMs,
  redis,
  getConnection = getSlackConnectionByUserId,
  fetchFn = fetch,
}: {
  userId: string;
  senderId: string;
  emailId: string;
  reason: 'hourly_limit' | 'min_delay';
  retryAtMs: number;
  redis: Pick<Redis, 'get' | 'set'>;
  getConnection?: (userId: string) => Promise<SlackConnectionRecord | null>;
  fetchFn?: typeof fetch;
}): Promise<boolean> {
  const dedupeKey = `slack:rate-limit:${userId}:${emailId}:${reason}`;
  const existing = await redis.get(dedupeKey);

  if (existing) {
    return false;
  }

  const connection = await getConnection(userId);

  if (!connection || !connection.accessToken) {
    return false;
  }

  const ttlSeconds = Math.max(60, Math.ceil(Math.max(retryAtMs - Date.now(), 0) / 1000) + 60);
  const channel = connection.slackUserId ?? connection.teamId ?? '#general';
  const text = `ReachInbox rate limit reached for sender ${senderId}. The next send for email ${emailId} is scheduled for ${new Date(retryAtMs).toISOString()} because the ${reason.replace('_', ' ')} cap was hit.`;

  try {
    const setResult = await redis.set(dedupeKey, '1', 'EX', ttlSeconds, 'NX');
    if (setResult !== 'OK') {
      return false;
    }

    const response = await fetchFn('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${connection.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel,
        text,
      }),
    });

    const body = (await response.json()) as { ok?: boolean; error?: string };

    if (!response.ok || body.ok === false) {
      return false;
    }

    return true;
  } catch (_error) {
    return false;
  }
}
