import { createDb } from '../src/platform/db';
import { config } from '../src/platform/config';
import { AuthService } from '../src/modules/auth/auth.service';

const db = createDb();
const storage = { signedGetUrl: async () => null } as any;
const svc = new AuthService(db, config, storage);
try {
  const r = await svc.login({ email: 'alice@chatup.dev', password: 'Password123!' });
  console.log('LOGIN OK', r.user.email);
} catch (e: any) {
  console.log('LOGIN FAILED:', e?.code ?? e?.name, '-', e?.message);
  console.log((e?.stack ?? '').split('\n').slice(0, 14).join('\n'));
}
await db.$disconnect();
