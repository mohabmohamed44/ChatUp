import { createHash, randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { LIMITS } from '@chatup/shared';
import type { AppConfig } from '../../platform/config';
import type { Db, Tx } from '../../platform/db';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export interface SessionBundle {
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

export async function createSession(
  db: Tx,
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

/**
 * CSRF-token lookup for the Socket.IO handshake. Cross-domain sockets (web on
 * one origin, API on another) never carry the HttpOnly session cookie — the
 * cookie belongs to the web domain — so the client sends the readable CSRF
 * cookie value in the handshake `auth` payload instead. The CSRF token is a
 * per-session unguessable secret, only ever transmitted over TLS, and grants
 * nothing beyond what the cookie already grants.
 */
export async function validateSessionByCsrf(db: Db, csrfToken: string | undefined) {
  if (!csrfToken) return null;
  const session = await db.session.findFirst({
    where: { csrfToken },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null;
  return session;
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
}

export function setSessionCookies(res: Response, config: AppConfig, bundle: SessionBundle): void {
  // Prod serves web + api on different origins (both https): the Socket.IO
  // handshake is cross-site, so the session cookie needs SameSite=None (which
  // requires Secure — already true when isProd). Dev stays Lax over http.
  const base: { path: string; secure: boolean; sameSite: 'none' | 'lax' } = {
    path: '/',
    secure: config.isProd,
    sameSite: config.isProd ? 'none' : 'lax',
  };
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
  // Attributes must match setSessionCookies or browsers keep the cookies.
  const opts: { path: string; secure: boolean; sameSite: 'none' | 'lax' } = {
    path: '/',
    secure: config.isProd,
    sameSite: config.isProd ? 'none' : 'lax',
  };
  res.clearCookie(LIMITS.SESSION_COOKIE_NAME, opts);
  res.clearCookie(LIMITS.CSRF_COOKIE_NAME, opts);
}
