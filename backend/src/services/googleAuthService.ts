import crypto from 'crypto';
import { randomUUID } from 'crypto';

import jwt from 'jsonwebtoken';

import { env } from '../config/env.ts';
import { prisma } from '../lib/prisma.ts';

export type GoogleUserProfile = {
  sub: string;
  email: string;
  name?: string | null;
  picture?: string | null;
  given_name?: string | null;
  family_name?: string | null;
};

export type AuthSessionPayload = {
  sub: string;
  email: string;
  name?: string | null;
  picture?: string | null;
  iat?: number;
  exp?: number;
};

export function buildGoogleAuthUrl({
  clientId = env.GOOGLE_CLIENT_ID,
  redirectUri = env.GOOGLE_REDIRECT_URI,
  state = buildStateToken(),
}: {
  clientId?: string;
  redirectUri?: string;
  state?: string;
} = {}) {
  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID is not configured.');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri ?? 'http://localhost:4000/api/auth/google/callback',
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode({
  code,
  clientId = env.GOOGLE_CLIENT_ID,
  clientSecret = env.GOOGLE_CLIENT_SECRET,
  redirectUri = env.GOOGLE_REDIRECT_URI,
}: {
  code: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
}) {
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials are not configured.');
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri ?? 'http://localhost:4000/api/auth/google/callback',
      grant_type: 'authorization_code',
    }).toString(),
  });

  const payload = await tokenResponse.json() as {
    access_token?: string;
    id_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenResponse.ok || !payload.id_token) {
    throw new Error(payload.error_description ?? payload.error ?? 'Google token exchange failed.');
  }

  return payload;
}

export function verifyAuthToken({
  token,
  secret = env.JWT_SECRET,
}: {
  token: string;
  secret?: string;
}) {
  if (!secret) {
    throw new Error('JWT_SECRET is not configured.');
  }

  const decoded = jwt.verify(token, secret) as AuthSessionPayload;
  return decoded;
}

export function signAuthToken({
  user,
  secret = env.JWT_SECRET,
}: {
  user: { id: string; email: string; name?: string | null; picture?: string | null; };
  secret?: string;
}) {
  if (!secret) {
    throw new Error('JWT_SECRET is not configured.');
  }

  return jwt.sign({
    sub: user.id,
    email: user.email,
    name: user.name ?? null,
    picture: user.picture ?? null,
  }, secret, {
    expiresIn: '7d',
  });
}

export async function upsertGoogleUser({
  profile,
}: {
  profile: GoogleUserProfile;
}) {
  const email = profile.email.toLowerCase();

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name: profile.name ?? profile.given_name ?? 'Google User',
    },
    create: {
      email,
      name: profile.name ?? profile.given_name ?? 'Google User',
    },
  });

  return user;
}

export function buildGoogleLogoutUrl() {
  return 'https://accounts.google.com/logout';
}

export function buildCookieHeader({
  token,
  maxAgeSeconds = 60 * 60 * 24 * 7,
  secure = env.NODE_ENV === 'production',
}: {
  token: string;
  maxAgeSeconds?: number;
  secure?: boolean;
}) {
  const expires = new Date(Date.now() + maxAgeSeconds * 1000);
  const sameSite = secure ? 'None' : 'Lax';
  const secureAttribute = secure ? '; Secure' : '';
  return `reachinbox_session=${token}; HttpOnly; Path=/; SameSite=${sameSite}${secureAttribute}; Expires=${expires.toUTCString()}`;
}

export function buildStateToken() {
  return crypto.randomBytes(16).toString('hex');
}
