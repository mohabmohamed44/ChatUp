import { createDb } from '../src/platform/db';
import { verifyPassword } from '../src/modules/auth/auth.password';

const db = createDb();
const users = await db.user.findMany({ select: { email: true, passwordHash: true } });
for (const u of users) {
  const ok = await verifyPassword('Password123!', u.passwordHash);
  console.log(JSON.stringify({ email: u.email, password123: ok, hashPrefix: u.passwordHash.slice(0, 48) }));
}
await db.$disconnect();
