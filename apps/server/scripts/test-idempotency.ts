/**
 * Idempotency test for message:send.
 *
 * Sends the same clientId twice and verifies the server returns
 * the same message id both times, and only one row lands in the DB.
 *
 * Usage:
 *   npx tsx scripts/test-idempotency.ts
 */

import { io, type Socket } from 'socket.io-client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { config } from '../src/platform/config';

const API = 'http://localhost:4000';
const EMAIL = 'alice@chatup.dev';
const PASSWORD = 'Password123!';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: config.DATABASE_URL }),
});

async function login(): Promise<string> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    redirect: 'manual',
  });
  if (!res.ok) {
    throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  }
  const cookies = res.headers.getSetCookie();
  if (cookies.length === 0) throw new Error('No session cookie returned');
  // getSetCookie() keeps each cookie intact; splitting the joined header on ","
  // would break on Expires dates, which contain commas.
  const sessionCookie = cookies
    .map((cookie) => cookie.split(';')[0]?.trim() ?? '')
    .find((cookie) => cookie.startsWith('chatup_session='));
  if (!sessionCookie) throw new Error('No session cookie returned');
  return sessionCookie;
}

async function getAliceConversationId(aliceId: string): Promise<string> {
  const participant = await prisma.conversationParticipant.findFirst({
    where: { userId: aliceId },
    select: { conversationId: true },
  });
  if (!participant) throw new Error('No conversation found for Alice');
  return participant.conversationId;
}

async function getAliceId(): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { email: EMAIL },
    select: { id: true },
  });
  if (!user) throw new Error('Alice not found — run the seed first');
  return user.id;
}

function emitWithAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response: T) => resolve(response));
  });
}

async function main() {
  console.log('1. Logging in as', EMAIL);
  const cookie = await login();
  console.log('   cookie acquired:', cookie.slice(0, 40) + '...');

  const aliceId = await getAliceId();
  const conversationId = await getAliceConversationId(aliceId);
  console.log('2. Alice id:', aliceId);
  console.log('   conversation id:', conversationId);

  console.log('3. Connecting socket...');
  const socket = io(API, {
    transports: ['websocket'],
    extraHeaders: { Cookie: cookie },
  });

  await new Promise<void>((resolve, reject) => {
    socket.on('connect', () => resolve());
    socket.on('connect_error', (err) => reject(err));
    setTimeout(() => reject(new Error('socket connect timeout')), 5000);
  });
  console.log('   connected:', socket.id);

  const clientId = crypto.randomUUID();
  const body = `idempotency test ${Date.now()}`;
  const payload = { conversationId, clientId, kind: 'text' as const, body };
  console.log('4. Sending same clientId twice:', clientId);

  const ack1 = await emitWithAck<{ ok: boolean; data?: { id: string } }>(
    socket,
    'message:send',
    payload,
  );
  const ack2 = await emitWithAck<{ ok: boolean; data?: { id: string } }>(
    socket,
    'message:send',
    payload,
  );

  console.log('   ack1:', JSON.stringify(ack1));
  console.log('   ack2:', JSON.stringify(ack2));

  const sameId = ack1.data?.id === ack2.data?.id;
  console.log('5. Same message id returned?', sameId);

  socket.disconnect();

  const rows = await prisma.message.findMany({
    where: { clientId },
    select: { id: true, body: true },
  });
  console.log('6. Rows in DB with this clientId:', rows.length);
  console.log('   rows:', JSON.stringify(rows));

  const passed = sameId && rows.length === 1;
  console.log('');
  console.log(passed ? 'PASS — idempotency works' : 'FAIL — duplicate row or different ids');
  process.exit(passed ? 0 : 1);
}

main()
  .catch((err) => {
    console.error('ERROR:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());