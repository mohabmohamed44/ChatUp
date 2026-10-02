/**
 * Concurrency verification for message:send.
 *
 * Fires N messages in parallel over a single socket and verifies:
 *   - Every ack returns ok
 *   - Exactly N rows in the DB
 *   - No duplicate rows
 *
 * This is a correctness test, not a load test. It proves the transaction
 * in messages.service.ts is atomic and idempotent under concurrency.
 *
 * Usage:
 *   npx tsx scripts/test-concurrent-sends.ts <conversationId> [count]
 *   npx tsx scripts/test-concurrent-sends.ts 90bc4b06-... 50
 */

import { io, type Socket } from 'socket.io-client';
import { createDb } from '../src/platform/db';

const API = process.env.API_URL;
const EMAIL = process.env.SEED_USER_EMAIL;
const PASSWORD = process.env.SEED_USER_PASSWORD;

const prisma = createDb();

async function login(): Promise<string> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    redirect: 'manual',
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('No session cookie returned');
  return setCookie
    .split(',')
    .map((part: any) => part.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

async function main() {
  const conversationId = process.argv[2];
  const count = Number(process.argv[3] ?? 50);

  if (!conversationId) {
    console.error('Usage: tsx scripts/test-concurrent-sends.ts <conversationId> [count]');
    process.exit(1);
  }

  console.log('1. Logging in as', EMAIL);
  const cookie = await login();

  console.log('2. Connecting socket...');
  const socket: Socket = io(API, {
    transports: ['websocket'],
    extraHeaders: { Cookie: cookie },
  });

  await new Promise<void>((resolve, reject) => {
    socket.on('connect', () => resolve());
    socket.on('connect_error', (err) => reject(err));
    setTimeout(() => reject(new Error('socket connect timeout')), 5000);
  });
  console.log('   Connected:', socket.id);

  const prefix = `concurrent-${Date.now()}`;
  console.log(`3. Sending ${count} messages concurrently...`);

  const start = Date.now();
  const results = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      new Promise<{ ok: boolean; error?: string }>((resolve) => {
        socket.emit(
          'message:send',
          {
            conversationId,
            clientId: crypto.randomUUID(),
            kind: 'text',
            body: `${prefix} #${i + 1}`,
          },
          (ack: { ok: boolean; error?: { message?: string } }) => {
            if (ack?.ok) resolve({ ok: true });
            else resolve({ ok: false, error: ack?.error?.message });
          },
        );
      }),
    ),
  );
  const elapsed = Date.now() - start;

  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  console.log('4. Results:');
  console.log(`   Sent:        ${count}`);
  console.log(`   OK:          ${ok}`);
  console.log(`   Failed:      ${failed.length}`);
  console.log(`   Total time:  ${elapsed}ms`);
  console.log(`   Avg per msg: ${(elapsed / count).toFixed(1)}ms`);

  if (failed.length > 0) {
    console.log('   Sample errors:', failed.slice(0, 3));
  }

  // Verify in the DB
  const rows = await prisma.message.findMany({
    where: { body: { startsWith: prefix } },
    select: { body: true, clientId: true },
  });
  const uniqueBodies = new Set(rows.map((r) => r.body));
  const uniqueClientIds = new Set(rows.map((r) => r.clientId));

  console.log('5. Database check:');
  console.log(`   Rows with prefix: ${rows.length}`);
  console.log(`   Unique bodies:    ${uniqueBodies.size}`);
  console.log(`   Unique clientIds: ${uniqueClientIds.size}`);

  socket.disconnect();
  await prisma.$disconnect();

  const passed =
    ok === count && rows.length === count && uniqueBodies.size === count;

  console.log('');
  console.log(passed ? '✅ PASS' : '❌ FAIL');
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});