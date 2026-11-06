import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../config/env.js';
import { signAuthToken } from '../services/googleAuthService.js';
import slackRoutes from './slackRoutes.js';

const { mockUpsert, mockDelete, mockBuildSlackAuthUrl, mockExchangeSlackCode, mockGetSlackConnection } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockDelete: vi.fn(),
  mockBuildSlackAuthUrl: vi.fn(),
  mockExchangeSlackCode: vi.fn(),
  mockGetSlackConnection: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: { slackConnection: { upsert: mockUpsert, delete: mockDelete } },
}));

vi.mock('../services/slackService.js', () => ({
  buildSlackAuthUrl: mockBuildSlackAuthUrl,
  exchangeSlackCodeForToken: mockExchangeSlackCode,
  getSlackConnectionByUserId: mockGetSlackConnection,
}));

function authToken(userId = 'user-1') {
  return signAuthToken({ user: { id: userId, email: 'demo@example.com', name: 'Demo User' } });
}

function appWithSlackRoutes() {
  const app = express();
  app.use('/api/slack', slackRoutes);
  return app;
}

describe('Slack integration routes', () => {
  beforeEach(() => {
    mockUpsert.mockReset();
    mockDelete.mockReset();
    mockBuildSlackAuthUrl.mockReset();
    mockExchangeSlackCode.mockReset();
    mockGetSlackConnection.mockReset();
    mockBuildSlackAuthUrl.mockImplementation(({ userId }: { userId: string }) => `https://slack.com/oauth/v2/authorize?state=${encodeURIComponent(userId)}`);
    mockUpsert.mockResolvedValue({ userId: 'user-1', teamId: 'T123', slackUserId: 'U123' });
    mockExchangeSlackCode.mockResolvedValue({ access_token: 'test-token', team: { id: 'T123' }, authed_user: { id: 'U123' } });
  });

  it('requires an authenticated session to start Slack OAuth', async () => {
    const response = await request(appWithSlackRoutes()).get('/api/slack/connect?userId=user-1');
    expect(response.status).toBe(401);
    expect(mockBuildSlackAuthUrl).not.toHaveBeenCalled();
  });

  it('starts OAuth for the authenticated user with a signed, expiring state', async () => {
    const response = await request(appWithSlackRoutes())
      .get('/api/slack/connect')
      .set('Authorization', `Bearer ${authToken()}`);

    expect(response.status).toBe(200);
    expect(response.body.authUrl).toContain('https://slack.com/oauth/v2/authorize');
    const state = new URL(response.body.authUrl).searchParams.get('state');
    expect(jwt.verify(state!, env.JWT_SECRET)).toMatchObject({ sub: 'user-1', purpose: 'slack_oauth' });
  });

  it('returns only the signed-in user Slack connection status', async () => {
    mockGetSlackConnection.mockResolvedValue({ userId: 'user-1', teamId: 'T123', slackUserId: 'U123', accessToken: 'secret' });
    const response = await request(appWithSlackRoutes())
      .get('/api/slack/status?userId=someone-else')
      .set('Authorization', `Bearer ${authToken()}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ connected: true, userId: 'user-1', teamId: 'T123' });
    expect(response.body.accessToken).toBeUndefined();
    expect(mockGetSlackConnection).toHaveBeenCalledWith('user-1');
  });

  it('disconnects Slack for the signed-in user', async () => {
    mockDelete.mockResolvedValue({ userId: 'user-1' });
    const response = await request(appWithSlackRoutes())
      .delete('/api/slack/disconnect')
      .set('Authorization', `Bearer ${authToken()}`);

    expect(response.status).toBe(200);
    expect(response.body.connected).toBe(false);
    expect(mockDelete).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
  });

  it('saves the connection for the signed state user and returns to the dashboard', async () => {
    const state = jwt.sign({ sub: 'user-1', purpose: 'slack_oauth' }, env.JWT_SECRET, { expiresIn: '10m' });
    const response = await request(appWithSlackRoutes())
      .get('/api/slack/oauth/callback')
      .query({ code: 'authorization-code', state })
      .redirects(0);

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('?slack=connected');
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1' },
      create: expect.objectContaining({ userId: 'user-1', accessToken: 'test-token' }),
    }));
  });
});
