import type { AuthUser, LoginInput, RegisterInput, UpdateProfileInput } from '@chatup/shared';
import type { AppConfig } from '../../platform/config';
import type { Db } from '../../platform/db';
import { Errors } from '../../platform/errors';
import { hashPassword, verifyPassword } from './auth.password';
import { createSession, revokeSession, type SessionBundle } from './auth.session';

type UserRecord = {
  id: string;
  email: string;
  displayName: string;
  avatarMediaId: string | null;
  createdAt: Date;
};

export function toAuthUser(user: UserRecord): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: null,
    createdAt: user.createdAt.toISOString(),
  };
}

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  async register(input: RegisterInput): Promise<{ user: AuthUser; session: SessionBundle }> {
    const existing = await this.db.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw Errors.conflict('An account with this email already exists');
    }
    const passwordHash = await hashPassword(input.password);
    const user = await this.db.user.create({
      data: { email: input.email, passwordHash, displayName: input.displayName },
    });
    const session = await createSession(this.db, this.config, user.id);
    return { user: toAuthUser(user), session };
  }

  async login(input: LoginInput): Promise<{ user: AuthUser; session: SessionBundle }> {
    const user = await this.db.user.findUnique({ where: { email: input.email } });
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw Errors.unauthorized('Invalid email or password');
    }
    const session = await createSession(this.db, this.config, user.id);
    return { user: toAuthUser(user), session };
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<AuthUser> {
    const user = await this.db.user.update({
      where: { id: userId },
      data: { displayName: input.displayName },
    });
    return toAuthUser(user);
  }

  async logout(sessionId: string): Promise<void> {
    await revokeSession(this.db, sessionId);
  }
}
