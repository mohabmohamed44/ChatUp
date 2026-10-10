import { createDb } from '../src/platform/db';
const db = createDb();
const cols: any[] = await db.$queryRawUnsafe(
  "SELECT column_name FROM information_schema.columns WHERE table_name='Session' ORDER BY 1",
);
console.log('Session columns:', cols.map((c) => c.column_name).join(','));
const migs: any[] = await db.$queryRawUnsafe(
  'SELECT migration_name FROM _prisma_migrations ORDER BY finished_at',
);
console.log('applied:', migs.map((m) => m.migration_name).join(' | '));
await db.$disconnect();
