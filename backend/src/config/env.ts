import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { z } from 'zod';

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env');
dotenv.config({ path: envPath, override: true });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/reachinbox'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  ELASTICSEARCH_URL: z.string().default('http://localhost:9200'),
  ELASTICSEARCH_API_KEY: z.string().optional(),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(1),
  EMAIL_FROM: z.string().default('noreply@reachinbox.local'),
  SMTP_HOST: z.string().default('smtp.ethereal.email'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z
    .union([z.boolean(), z.string()])
    .transform((value) => typeof value === 'string' ? value.toLowerCase() === 'true' : value)
    .pipe(z.boolean())
    .default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_REDIRECT_URI: z.string().default('http://localhost:4000/api/slack/oauth/callback'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().default('http://localhost:4000/api/auth/google/callback'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  JWT_SECRET: z.string().default('reachinbox-dev-secret-change-me'),
  BULL_BOARD_USERNAME: z.string().optional(),
  BULL_BOARD_PASSWORD: z.string().optional(),
});

export const env = envSchema.parse(process.env);
