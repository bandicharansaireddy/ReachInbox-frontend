import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..', '..');
const backendDir = path.resolve(projectRoot, 'backend');
const originalCwd = process.cwd();
const originalEnv = { ...process.env };

afterEach(() => {
  process.chdir(originalCwd);
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe('env configuration', () => {
  it('loads the repo-root .env even when the process starts from the backend folder', async () => {
    process.chdir(backendDir);
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.JWT_SECRET;

    const { env } = await import('./env.ts');

    expect(env.GOOGLE_CLIENT_ID).toBeTruthy();
    expect(env.JWT_SECRET).toBeTruthy();
  });

  it('treats SMTP_SECURE=false as a real boolean false', async () => {
    process.env.SMTP_SECURE = 'false';

    const { env } = await import('./env.ts');

    expect(env.SMTP_SECURE).toBe(false);
  });
});
