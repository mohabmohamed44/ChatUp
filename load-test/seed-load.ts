// Seeds synthetic load users + sessions for the k6 production load test.
// Run against the TARGET database (dev DB for local, assessment DB for prod runs):
//   DATABASE_URL=... npm run load:seed
//
// Creates LOAD_USERS (default 100) users load001@load.test… with known password,
// pairs them into 1:1 conversations (no duplicate-1:1 violation by construction),
// mints one session per user via the app's own createSession(), and writes
// load-test/.sessions.json (gitignored — raw session tokens, never commit).
//
// Safe to re-run: users/conversations upserted, sessions rotated (old load
// sessions revoked so the file never accumulates stale tokens).

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/server/src/generated/prisma/client';
import { config } from '../apps/server/src/platform/config';
import { createSession } from '../apps/server/src/modules/auth/auth.session';
import { LIMITS } from '../packages/shared/src/index';

const LOAD_USERS = Number(process.env.LOAD_USERS || 100);
const LOAD_PASSWORD = process.env.LOAD_PASSWORD || 'LoadTest123!';
const OUT_FILE = path.resolve(import.meta.dirname, '.sessions.json');

if (!Number.isInteger(LOAD_USERS) || LOAD_USERS < 2 || LOAD_USERS % 2 !== 0) {
  throw new Error('LOAD_USERS must be an even integer >= 2 (users are paired 1:1).');
}
if (LOAD_PASSWORD.length < LIMITS.PASSWORD_MIN) {
  throw new Error(`LOAD_PASSWORD must be >= ${LIMITS.PASSWORD_MIN} chars.`);
}

async function hashPassword(password: string): Promise<string> {
  const { randomBytes, scrypt } = await import('node:crypto');
  const salt = randomBytes(16);
  const key = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derived) => {
      if (err) reject(err);
      else resolve(derived as Buffer);
    });
  });
  return ['scrypt', 16384, 8, 1, salt.toString('base64'), key.toString('base64')].join('$');
}

async function main(): Promise<void> {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.DATABASE_URL }),
  });
  try {
    console.log(`Seeding ${LOAD_USERS} synthetic load users…`);
    const passwordHash = await hashPassword(LOAD_PASSWORD);

    const users: Array<{ id: string; email: string }> = [];
    for (let i = 1; i <= LOAD_USERS; i++) {
      const email = `load${String(i).padStart(3, '0')}@load.test`;
      const user = await db.user.upsert({
        where: { email },
        update: { passwordHash },
        create: { email, passwordHash, displayName: `Load ${i}` },
        select: { id: true, email: true },
      });
      users.push(user);
    }

    // Rotate sessions so re-runs don't pile up live tokens.
    await db.session.updateMany({
      where: { userId: { in: users.map((u) => u.id) }, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const out: Array<{
      userId: string;
      email: string;
      conversationId: string;
      token: string;
      csrfToken: string;
    }> = [];

    for (let i = 0; i < users.length; i += 2) {
      const a = users[i] as { id: string; email: string };
      const b = users[i + 1] as { id: string; email: string };
      const directKey = [a.id, b.id].sort().join(':');
      const conversation = await db.conversation.upsert({
        where: { directKey },
        update: { lastActivityAt: new Date() },
        create: {
          directKey,
          lastActivityAt: new Date(),
          participants: { create: [{ userId: a.id }, { userId: b.id }] },
        },
        select: { id: true },
      });

      for (const u of [a, b]) {
        const bundle = await db.$transaction((tx) => createSession(tx, config, u.id));
        out.push({
          userId: u.id,
          email: u.email,
          conversationId: conversation.id,
          token: bundle.token,
          csrfToken: bundle.csrfToken,
        });
      }
    }

    await writeFile(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`Wrote ${out.length} sessions → ${OUT_FILE} (gitignored, do not commit)`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
