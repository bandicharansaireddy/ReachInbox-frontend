import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildSlackAuthUrl, sendRateLimitSlackNotification } from './slackService.js';

describe('Slack integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a Slack OAuth URL with the workspace redirect and state', () => {
    const url = buildSlackAuthUrl({
      userId: 'user-123',
      clientId: 'slack-client-id',
      redirectUri: 'http://localhost:4000/api/slack/oauth/callback',
    });

    expect(url).toContain('https://slack.com/oauth/v2/authorize');
    expect(url).toContain('client_id=slack-client-id');
    expect(url).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A4000%2Fapi%2Fslack%2Foauth%2Fcallback');
    expect(url).toContain('state=user-123');
  });

  it('sends a Slack notification once per rate-limit event and ignores missing connections', async () => {
    const redis = {
      set: vi.fn()
        .mockResolvedValueOnce('OK')
        .mockResolvedValueOnce(null),
      get: vi.fn().mockResolvedValue(null),
    } as any;

    const connection = {
      userId: 'user-123',
      teamId: 'T123',
      slackUserId: 'U123',
      accessToken: 'xoxb-test-token',
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, ts: '123.456' }),
    });

    const delivered = await sendRateLimitSlackNotification({
      userId: 'user-123',
      senderId: 'sender-42',
      emailId: 'email-42',
      reason: 'hourly_limit',
      retryAtMs: Date.now() + 60_000,
      redis,
      getConnection: async () => connection,
      fetchFn: fetchMock,
    });

    expect(delivered).toBe(true);
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const secondAttempt = await sendRateLimitSlackNotification({
      userId: 'user-123',
      senderId: 'sender-42',
      emailId: 'email-42',
      reason: 'hourly_limit',
      retryAtMs: Date.now() + 60_000,
      redis,
      getConnection: async () => connection,
      fetchFn: fetchMock,
    });

    expect(secondAttempt).toBe(false);
  });

  it('never throws when Slack is unavailable or disconnected', async () => {
    await expect(
      sendRateLimitSlackNotification({
        userId: 'user-456',
        senderId: 'sender-66',
        emailId: 'email-66',
        reason: 'min_delay',
        retryAtMs: Date.now() + 30_000,
        redis: {
          set: vi.fn().mockResolvedValue('OK'),
          get: vi.fn().mockResolvedValue(null),
        } as any,
        getConnection: async () => null,
        fetchFn: vi.fn().mockRejectedValue(new Error('network down')),
      }),
    ).resolves.toBe(false);
  });
});
