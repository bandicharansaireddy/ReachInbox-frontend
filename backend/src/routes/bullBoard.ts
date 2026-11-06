import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Router } from 'express';

import { env } from '../config/env.ts';

export function createBullBoardRouter({
  username = env.BULL_BOARD_USERNAME,
  password = env.BULL_BOARD_PASSWORD,
  queues,
}: {
  username?: string;
  password?: string;
  queues: any[];
}) {
  const router = Router();

  const requireBasicAuth = (req: any, res: any, next: any) => {
    if (!username || !password) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
      return res.status(401).json({ error: 'Bull Board access is not configured.' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
      return res.status(401).json({ error: 'Authorization required.' });
    }

    const base64 = authHeader.replace('Basic ', '');
    const decoded = Buffer.from(base64, 'base64').toString('utf8');
    const [providedUsername, providedPassword] = decoded.split(':');

    if (providedUsername !== username || providedPassword !== password) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    return next();
  };

  router.use(requireBasicAuth);

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: queues.map((queue) => new BullMQAdapter(queue)),
    serverAdapter,
    options: {
      uiConfig: {
        boardTitle: 'ReachInbox BullMQ Dashboard',
      },
    },
  });

  router.use('/', serverAdapter.getRouter());
  return router;
}
