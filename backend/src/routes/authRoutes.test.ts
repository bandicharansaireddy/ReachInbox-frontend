import cors from 'cors';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('auth routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('rejects missing authentication for protected routes', async () => {
    const { default: authRoutes, requireAuth } = await import('./authRoutes.js');
    const app = express();
    app.use('/api', authRoutes);
    app.get('/protected', requireAuth, (_req, res) => res.json({ ok: true }));

    const response = await request(app).get('/protected');
    expect(response.status).toBe(401);
  });

  it('redirects the browser to Google when starting Google OAuth', async () => {
    const { default: authRoutes } = await import('./authRoutes.js');
    const app = express();
    app.use('/api/auth', authRoutes);

    const response = await request(app).get('/api/auth/google/login').redirects(0);
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(response.headers.location).toContain('client_id=');
  });

  it('allows the frontend origin to access authenticated endpoints with credentials', async () => {
    const app = express();
    app.use(cors({
      origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
      credentials: true,
    }));
    app.get('/api/auth/me', (_req, res) => {
      res.status(401).json({ error: 'Authentication required.' });
    });

    const response = await request(app)
      .get('/api/auth/me')
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', 'reachinbox_session=test-token');

    expect(response.status).toBe(401);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });
});
