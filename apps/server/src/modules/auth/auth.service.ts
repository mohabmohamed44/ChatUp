import type { AuthUser, LoginInput, RegisterInput, UpdateProfileInput } from '@chatup/shared';
import type { AppConfig } from '../../platform/config';
import type { Db } from '../../platform/db';
import { Errors } from '../../platform/errors';
import { hashPassword, verifyPassword } from './auth.password';
import { createSession, revokeSession, type SessionBundle } from './auth.session';
import type { StorageService } from '../../platform/storage';
import type { User } from '../../generated/prisma/client';

export async function toAuthUser(
  user: User,
  storage: StorageService,
  ttlSeconds: number,
): Promise<AuthUser> {
  let avatarUrl: string | null = null;
  if (user.avatarMediaId) {
    avatarUrl = await storage.signedGetUrl(
      `attachments/${user.avatarMediaId}`,
      ttlSeconds,
    );
  }
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl,
    createdAt: user.createdAt.toISOString(),
  };
}

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly storage: StorageService,
  ) {}

  async register(
    input: RegisterInput,
  ): Promise<{ user: AuthUser; session: SessionBundle }> {
    const existing = await this.db.user.findUnique({
      where: { email: input.email },
    });
    if (existing) {
      throw Errors.conflict('An account with this email already exists');
    }

    const passwordHash = await hashPassword(input.password);

    const { user, session } = await this.db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          displayName: input.displayName,
        },
      });
      const createdSession = await createSession(tx, this.config, created.id);
      return { user: created, session: createdSession };
    });

    return {
      user: await toAuthUser(user, this.storage, this.config.MEDIA_URL_TTL_SECONDS),
      session,
    };
  }

  async login(
    input: LoginInput,
  ): Promise<{ user: AuthUser; session: SessionBundle }> {
    const user = await this.db.user.findUnique({
      where: { email: input.email },
    });
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw Errors.unauthorized('Invalid email or password');
    }

    const session = await createSession(this.db, this.config, user.id);

    return {
      user: await toAuthUser(user, this.storage, this.config.MEDIA_URL_TTL_SECONDS),
      session,
    };
  }

  async updateProfile(
    userId: string,
    input: UpdateProfileInput,
    sessionId: string,
  ): Promise<AuthUser> {
    // If the caller is setting an avatar, verify the attachment belongs
    // to them and is ready for use.
    if (input.avatarMediaId) {
      const media = await this.db.mediaAttachment.findUnique({
        where: { id: input.avatarMediaId },
      });
      if (
        !media ||
        media.ownerId !== userId ||
        media.status !== 'COMPLETED'
      ) {
        throw Errors.badRequest('Avatar not found or not ready');
      }
    }

    const user = await this.db.user.update({
      where: { id: userId },
      data: {
        ...(input.displayName !== undefined
          ? { displayName: input.displayName }
          : {}),
        ...(input.avatarMediaId !== undefined
          ? { avatarMediaId: input.avatarMediaId }
          : {}),
      },
    });

    // FCM registration is bound to the session that registered it (one FID
    // per device session). An FID identifies ONE browser install, so detach
    // it from any other session first (prevents user A's push appearing in
    // user B's browser after a re-login). Empty string clears.
    if (input.fid !== undefined) {
      const token = input.fid.trim().slice(0, 1024) || null;
      await this.db.$transaction(async (tx) => {
        if (token) {
          await tx.session.updateMany({
            where: { fid: token, id: { not: sessionId } },
            data: { fid: null },
          });
        }
        await tx.session.updateMany({
          where: { id: sessionId },
          data: { fid: token },
        });
      });
    }

    return await toAuthUser(user, this.storage, this.config.MEDIA_URL_TTL_SECONDS);
  }

  /** Removes the FCM registration (FID) from a session (logout / opt-out). */
  async clearFid(sessionId: string): Promise<void> {
    await this.db.session.updateMany({
      where: { id: sessionId },
      data: { fid: null },
    });
  }

  async logout(sessionId: string): Promise<void> {
    await revokeSession(this.db, sessionId);
  }
}