import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createBullBoardRouter } from './bullBoard.js';

describe('Bull Board auth', () => {
  it('denies the queue dashboard when credentials are missing or invalid', async () => {
    const app = express();
    app.use('/admin/queues', createBullBoardRouter({
      username: 'admin',
      password: 'secret',
      queues: [],
    }));

    const missingAuth = await request(app).get('/admin/queues');
    expect(missingAuth.status).toBe(401);

    const invalidAuth = await request(app)
      .get('/admin/queues')
      .auth('admin', 'wrong-password');

    expect(invalidAuth.status).toBe(401);
  });
});
