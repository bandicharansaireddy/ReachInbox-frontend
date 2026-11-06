import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { signAuthToken } from '../services/googleAuthService.js';

const { mockFindMany, mockUpsert, mockCreate } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockUpsert: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    sender: {
      findMany: mockFindMany,
      upsert: mockUpsert,
      create: mockCreate,
    },
  },
}));

describe('sender routes', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
    mockUpsert.mockReset();
    mockCreate.mockReset();
  });

  it('lists the current user senders after authentication', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'sender-1', displayName: 'Sales', emailAddress: 'sales@example.com', userId: 'user-1' },
    ]);

    const { default: senderRoutes } = await import('./senderRoutes.js');
    const app = express();
    const token = signAuthToken({ user: { id: 'user-1', email: 'demo@example.com', name: 'Demo', picture: null } });

    app.use(express.json());
    app.use('/api/senders', senderRoutes);

    const response = await request(app)
      .get('/api/senders')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.senders).toHaveLength(1);
    expect(response.body.senders[0].emailAddress).toBe('sales@example.com');
  });

  it('creates a sender for the authenticated user and prevents duplicate registration', async () => {
    const { default: senderRoutes } = await import('./senderRoutes.js');
    const app = express();
    const token = signAuthToken({ user: { id: 'user-1', email: 'demo@example.com', name: 'Demo', picture: null } });

    mockUpsert.mockResolvedValue({ id: 'sender-2', userId: 'user-1', displayName: 'Support', emailAddress: 'support@example.com' });

    app.use(express.json());
    app.use('/api/senders', senderRoutes);

    const response = await request(app)
      .post('/api/senders')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'Support', emailAddress: 'support@example.com' });

    expect(response.status).toBe(201);
    expect(response.body.sender.emailAddress).toBe('support@example.com');
    expect(mockUpsert).toHaveBeenCalled();
  });
});
