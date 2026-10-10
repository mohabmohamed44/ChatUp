import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv({ path: path.resolve(import.meta.dirname, '../../../../.env'), quiet: true });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  SESSION_SECRET: z.string().min(16),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  // Google Cloud Storage for media attachments.
  // Local dev: GCS_EMULATOR_URL points at the fake-gcs-server container from docker-compose.yml.
  // Real GCP: leave GCS_EMULATOR_URL empty; auth uses Application Default Credentials
  // (GOOGLE_APPLICATION_CREDENTIALS key file locally, attached service account on GCP).
  GCS_PROJECT_ID: z.string().default(''),
  GCS_BUCKET: z.string().min(1).default('chatup-media'),
  GCS_EMULATOR_URL: z.string().default(''),
  MEDIA_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  // Firebase Cloud Messaging for offline push (optional, disabled by default).
  // Auth prefers an explicit key file (FCM_SERVICE_ACCOUNT_PATH) and falls
  // back to Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS /
  // attached service account on GCP).
  // NOTE: z.coerce.boolean() treats the string "false" as true — stringbool
  // parses "true"/"false" correctly.
  FCM_ENABLED: z.stringbool().default(false),
  FCM_PROJECT_ID: z.string().default(''),
  FCM_DRY_RUN: z.stringbool().default(false),
  FCM_SERVICE_ACCOUNT_PATH: z.string().default(''),
  // Public base URL of the web app (https in production / tunnel tests).
  // Used for absolute FCM webpush link + icon URLs (FCM requires absolute URLs).
  APP_URL: z.string().default('http://localhost:3000'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i: z.core.$ZodIssue) => `${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const config = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',
  isDev: parsed.data.NODE_ENV === 'development',
  isTest: parsed.data.NODE_ENV === 'test',
  corsOrigins: parsed.data.CORS_ORIGIN.split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
};

export type AppConfig = typeof config;
