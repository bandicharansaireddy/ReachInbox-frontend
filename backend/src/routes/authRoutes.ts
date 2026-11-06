import crypto from 'node:crypto';

import { Router } from 'express';
import jwt from 'jsonwebtoken';

import { env } from '../config/env.ts';
import { prisma } from '../lib/prisma.ts';
import {
  buildCookieHeader,
  buildGoogleAuthUrl,
  buildGoogleLogoutUrl,
  exchangeGoogleCode,
  signAuthToken,
  upsertGoogleUser,
  verifyAuthToken,
} from '../services/googleAuthService.ts';

const authRoutes = Router();

function getCookieValue(req: any, name: string) {
  const cookieHeader = req.headers.cookie ?? '';
  return cookieHeader
    .split(';')
    .map((part: string) => part.trim())
    .find((part: string) => part.startsWith(`${name}=`))
    ?.replace(`${name}=`, '') ?? null;
}

function redirectWithFrontendError(res: any, message: string) {
  const frontendUrl = `${env.FRONTEND_URL ?? 'http://localhost:5173'}?auth=error&message=${encodeURIComponent(message)}`;
  return res.redirect(frontendUrl);
}

export function requireAuth(req: any, res: any, next: any) {
  const authorization = req.headers.authorization;
  const cookieHeader = req.headers.cookie ?? '';
  const cookieToken = cookieHeader
    .split(';')
    .map((part: string) => part.trim())
    .find((part: string) => part.startsWith('reachinbox_session='));

  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : cookieToken?.replace('reachinbox_session=', '') || null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const decoded = verifyAuthToken({ token });
    req.user = decoded;
    return next();
  } catch (_error) {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }
}

authRoutes.get('/google/login', (_req, res) => {
  try {
    const state = crypto.randomBytes(16).toString('hex');
    const url = buildGoogleAuthUrl({ state });

    res.cookie('reachinbox_google_oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      maxAge: 10 * 60 * 1000,
      path: '/',
    });

    return res.redirect(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google OAuth is not configured';
    return redirectWithFrontendError(res, message);
  }
});

authRoutes.get('/google/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const expectedState = getCookieValue(req, 'reachinbox_google_oauth_state');

  if (!code) {
    return redirectWithFrontendError(res, 'OAuth code is required.');
  }

  if (!state || !expectedState || state !== expectedState) {
    return redirectWithFrontendError(res, 'Invalid or expired OAuth state.');
  }

  res.clearCookie('reachinbox_google_oauth_state', { path: '/' });

  try {
    const tokenResponse = await exchangeGoogleCode({ code });
    const idToken = tokenResponse.id_token ?? '';
    const payload = jwt.decode(idToken) as { sub?: string; email?: string; name?: string; picture?: string } | null;

    if (!payload?.email) {
      return redirectWithFrontendError(res, 'Google user information is missing.');
    }

    const user = await upsertGoogleUser({
      profile: {
        sub: payload.sub ?? '',
        email: payload.email,
        name: payload.name ?? null,
        picture: payload.picture ?? null,
      },
    });

    const token = signAuthToken({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: null,
      },
    });

    res.setHeader('Set-Cookie', buildCookieHeader({ token }));
    return res.redirect(`${env.FRONTEND_URL ?? 'http://localhost:5173'}?auth=success`);
  } catch (error) {
    console.error('Google OAuth callback failed:', error);
    return redirectWithFrontendError(res, error instanceof Error ? error.message : 'Google sign-in failed.');
  }
});

authRoutes.get('/me', requireAuth, async (req: any, res) => {
  const tokenUser = req.user as { sub: string; email: string; name?: string | null };

  try {
    const user = await prisma.user.findUnique({
      where: { id: tokenUser.sub },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (_error) {
    return res.status(500).json({ error: 'Unable to load user profile.' });
  }
});

authRoutes.post('/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'reachinbox_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax');
  return res.json({ success: true, logoutUrl: buildGoogleLogoutUrl() });
});

export default authRoutes;
