import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { signAuthToken } from '../services/googleAuthService.js';

const { mockFindMany } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    email: {
      findMany: mockFindMany,
    },
  },
}));

describe('email dashboard routes', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it('requires authentication before loading the dashboard email list', async () => {
    const { default: emailRoutes } = await import('./emailRoutes.js');
    const app = express();
    app.use('/api/emails', emailRoutes);

    const response = await request(app).get('/api/emails?status=scheduled');

    expect(response.status).toBe(401);
  });

  it('returns scheduled emails for the signed-in user dashboard', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'email-1',
        recipientEmail: 'hello@example.com',
        subject: 'Quarterly update',
        body: 'Hello there',
        status: 'SCHEDULED',
        scheduledFor: new Date('2026-11-10T12:00:00.000Z'),
        sentAt: null,
        createdAt: new Date('2026-11-05T09:00:00.000Z'),
        updatedAt: new Date('2026-11-05T09:00:00.000Z'),
        sender: {
          id: 'sender-1',
          displayName: 'Marketing Team',
          emailAddress: 'marketing@example.com',
        },
      },
    ]);

    const { default: emailRoutes } = await import('./emailRoutes.js');
    const app = express();
    const token = signAuthToken({
      user: {
        id: 'user-1',
        email: 'demo@example.com',
        name: 'Demo User',
        picture: null,
      },
    });

    app.use('/api/emails', emailRoutes);

    const response = await request(app)
      .get('/api/emails?status=scheduled')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.emails).toHaveLength(1);
    expect(response.body.emails[0].recipientEmail).toBe('hello@example.com');
    expect(response.body.emails[0].status).toBe('SCHEDULED');
    expect(mockFindMany).toHaveBeenCalled();
  });

  it('includes failed deliveries in the Sent dashboard view', async () => {
    mockFindMany.mockResolvedValue([{
      id: 'email-failed',
      recipientEmail: 'failed@example.com',
      subject: 'Delivery failed',
      body: 'Hello',
      status: 'FAILED',
      scheduledFor: new Date('2026-11-05T09:00:00.000Z'),
      sentAt: null,
      createdAt: new Date('2026-11-05T08:00:00.000Z'),
      updatedAt: new Date('2026-11-05T09:01:00.000Z'),
      sender: null,
    }]);
    const { default: emailRoutes } = await import('./emailRoutes.js');
    const app = express();
    const token = signAuthToken({ user: { id: 'user-1', email: 'demo@example.com', name: 'Demo User' } });
    app.use('/api/emails', emailRoutes);

    const response = await request(app)
      .get('/api/emails?status=sent')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.emails[0]).toMatchObject({
      id: 'email-failed',
      status: 'FAILED',
      updatedAt: '2026-11-05T09:01:00.000Z',
    });
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: 'user-1',
        status: { in: ['SENT', 'FAILED'] },
      }),
    }));
  });
});
