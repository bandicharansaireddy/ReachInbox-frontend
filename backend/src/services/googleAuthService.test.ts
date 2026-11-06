import { describe, expect, it } from 'vitest';

import { buildGoogleAuthUrl, signAuthToken, verifyAuthToken } from './googleAuthService.js';

describe('Google auth helpers', () => {
  it('builds the Google OAuth URL with the app redirect and scope', () => {
    const url = buildGoogleAuthUrl({
      clientId: 'google-client-id',
      redirectUri: 'http://localhost:4000/api/auth/google/callback',
    });

    expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url).toContain('client_id=google-client-id');
    expect(url).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A4000%2Fapi%2Fauth%2Fgoogle%2Fcallback');
    expect(url).toContain('scope=openid+email+profile');
  });

  it('verifies a signed user token payload', () => {
    const payload = {
      id: 'google-user-123',
      email: 'user@example.com',
      name: 'Google User',
      picture: 'https://example.com/avatar.png',
    };

    const token = signAuthToken({
      user: payload,
      secret: 'test-secret',
    });

    const verified = verifyAuthToken({
      token,
      secret: 'test-secret',
    });

    expect(verified).toMatchObject({
      sub: payload.id,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    });
  });
});
