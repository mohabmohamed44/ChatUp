import { createHash, randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { LIMITS } from '@chatup/shared';
import type { AppConfig } from '../../platform/config';
import type { Db } from '../../platform/db';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export interface SessionBundle {
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

export async function createSession(
  db: Db,
  config: AppConfig,
  userId: string,
): Promise<SessionBundle> {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_SECONDS * 1000);
  await db.session.create({ data: { tokenHash: sha256(token), csrfToken, userId, expiresAt } });
  return { token, csrfToken, expiresAt };
}

export async function validateSession(db: Db, token: string | undefined) {
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null;
  return session;
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
}

export function setSessionCookies(
  res: Response,
  config: AppConfig,
  bundle: SessionBundle,
): void {
  const base = { path: '/', secure: config.isProd, sameSite: 'lax' as const };
  res.cookie(LIMITS.SESSION_COOKIE_NAME, bundle.token, {
    ...base,
    httpOnly: true,
    expires: bundle.expiresAt,
  });
  res.cookie(LIMITS.CSRF_COOKIE_NAME, bundle.csrfToken, {
    ...base,
    httpOnly: false,
    expires: bundle.expiresAt,
  });
}

export function clearSessionCookies(res: Response, config: AppConfig): void {
  const opts = { path: '/', secure: config.isProd, sameSite: 'lax' as const };
  res.clearCookie(LIMITS.SESSION_COOKIE_NAME, opts);
  res.clearCookie(LIMITS.CSRF_COOKIE_NAME, opts);
}
