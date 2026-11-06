import cors from 'cors';
import express from 'express';
import morgan from 'morgan';

import { env } from './config/env.ts';
import { createEmailQueue } from './queue/emailQueue.ts';
import authRoutes from './routes/authRoutes.ts';
import { createBullBoardRouter } from './routes/bullBoard.ts';
import emailRoutes from './routes/emailRoutes.ts';
import senderRoutes from './routes/senderRoutes.ts';
import slackRoutes from './routes/slackRoutes.ts';
import { retryQueuedEmailIndexEntries } from './services/emailSearchService.ts';

export const app = express();

const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  env.FRONTEND_URL,
]);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin ${origin} is not allowed by CORS.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
}));
app.use(express.json());
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/', (_req, res) => {
  res.json({
    name: 'ReachInbox API',
    status: 'ready',
    environment: env.NODE_ENV,
  });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'reachinbox-backend',
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
  });
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'reachinbox-backend',
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/senders', senderRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/slack', slackRoutes);

void retryQueuedEmailIndexEntries().catch(() => undefined);

const emailQueue = createEmailQueue();
app.use('/admin/queues', createBullBoardRouter({
  username: env.BULL_BOARD_USERNAME,
  password: env.BULL_BOARD_PASSWORD,
  queues: [emailQueue],
}));

if (env.NODE_ENV !== 'test') {
  app.listen(env.PORT, () => {
    console.log(`ReachInbox backend listening on http://localhost:${env.PORT}`);
  });
}
