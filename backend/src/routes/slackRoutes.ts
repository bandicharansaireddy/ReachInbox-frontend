import { Router } from 'express';
import jwt from 'jsonwebtoken';

import { env } from '../config/env.ts';
import { prisma } from '../lib/prisma.ts';
import {
  buildSlackAuthUrl,
  exchangeSlackCodeForToken,
  getSlackConnectionByUserId,
} from '../services/slackService.ts';
import { requireAuth } from './authRoutes.ts';

const slackRoutes = Router();

function getAuthenticatedUserId(req: any): string {
  return req.user?.sub ?? req.user?.id ?? '';
}

function redirectToFrontend(res: any, params: Record<string, string>) {
  const url = new URL(env.FRONTEND_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return res.redirect(url.toString());
}

slackRoutes.get('/connect', requireAuth, (req: any, res) => {
  const userId = getAuthenticatedUserId(req);
  if (!userId) return res.status(401).json({ error: 'Authentication required.' });

  try {
    const state = jwt.sign({ sub: userId, purpose: 'slack_oauth' }, env.JWT_SECRET, { expiresIn: '10m' });
    const authUrl = buildSlackAuthUrl({ userId: state });
    return res.json({ authUrl });
  } catch (error) {
    console.error('Slack OAuth configuration error:', error);
    return res.status(500).json({ error: 'Slack OAuth is not configured in this environment.' });
  }
});

slackRoutes.get('/oauth/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : null;
  const state = typeof req.query.state === 'string' ? req.query.state : null;

  if (!state) return redirectToFrontend(res, { slackError: 'Slack authorization returned without state.' });

  let userId: string;
  try {
    const decoded = jwt.verify(state, env.JWT_SECRET) as jwt.JwtPayload;
    if (decoded.purpose !== 'slack_oauth' || typeof decoded.sub !== 'string') throw new Error('Invalid state');
    userId = decoded.sub;
  } catch (_error) {
    return redirectToFrontend(res, { slackError: 'Slack connection expired. Please try again.' });
  }

  if (typeof req.query.error === 'string') {
    return redirectToFrontend(res, { slackError: 'Slack authorization was not completed.' });
  }
  if (!code) return redirectToFrontend(res, { slackError: 'Slack callback is missing the authorization code.' });

  try {
    const tokenResponse = await exchangeSlackCodeForToken({ code });
    await prisma.slackConnection.upsert({
      where: { userId },
      update: {
        accessToken: tokenResponse.access_token,
        teamId: tokenResponse.team?.id ?? null,
        slackUserId: tokenResponse.authed_user?.id ?? tokenResponse.user?.id ?? null,
      },
      create: {
        userId,
        accessToken: tokenResponse.access_token,
        teamId: tokenResponse.team?.id ?? null,
        slackUserId: tokenResponse.authed_user?.id ?? tokenResponse.user?.id ?? null,
      },
    });

    return redirectToFrontend(res, { slack: 'connected' });
  } catch (error) {
    console.error('Slack OAuth callback failed:', error);
    return redirectToFrontend(res, { slackError: 'Slack could not be connected. Check configuration and try again.' });
  }
});

slackRoutes.get('/status', requireAuth, async (req: any, res) => {
  const userId = getAuthenticatedUserId(req);
  if (!userId) return res.status(401).json({ error: 'Authentication required.' });

  const connection = await getSlackConnectionByUserId(userId);
  return res.json({
    connected: Boolean(connection?.accessToken),
    userId,
    teamId: connection?.teamId ?? null,
    slackUserId: connection?.slackUserId ?? null,
  });
});

slackRoutes.delete('/disconnect', requireAuth, async (req: any, res) => {
  const userId = getAuthenticatedUserId(req);
  if (!userId) return res.status(401).json({ error: 'Authentication required.' });

  try {
    await prisma.slackConnection.delete({ where: { userId } });
  } catch (_error) {
    // Slack may already be disconnected.
  }

  return res.json({ connected: false, userId });
});

export default slackRoutes;
