/**
 * Seeds N synthetic text messages into a conversation.
 *
 * Usage:
 *   npx tsx scripts/seed-messages.ts            # sends 40 by default
 *   npx tsx scripts/seed-messages.ts 60         # sends 60
 *
 * Picks the first conversation Alice participates in.
 * All messages are sent as Alice so they land in her outbox
 * and can be paginated from her client.
 */

import { io, type Socket } from 'socket.io-client';
import { createDb } from '../src/platform/db';

const API = 'http://localhost:4000';
const EMAIL = 'alice@chatup.dev';
const PASSWORD = 'Password123!';

const requested = Number(process.argv[2] ?? 40);
const COUNT = Number.isInteger(requested) && requested > 0 ? requested : 40;

const prisma = createDb();

async function login(): Promise<string> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    redirect: 'manual',
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  // getSetCookie() keeps each cookie intact; splitting the joined header on ","
  // would break on Expires dates, which contain commas.
  const sessionCookie = res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0]?.trim() ?? '')
    .find((cookie) => cookie.startsWith('chatup_session='));
  if (!sessionCookie) throw new Error('No session cookie');
  return sessionCookie;
}

async function getAliceAndConversation() {
  const alice = await prisma.user.findUnique({
    where: { email: EMAIL },
    select: { id: true },
  });
  if (!alice) throw new Error('Alice not found — run the seed first');

  const participant = await prisma.conversationParticipant.findFirst({
    where: { userId: alice.id },
    select: { conversationId: true },
  });
  if (!participant) throw new Error('No conversation for Alice');

  return { aliceId: alice.id, conversationId: participant.conversationId };
}

function emitWithAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response: T) => resolve(response));
  });
}

async function main() {
  console.log(`Seeding ${COUNT} messages...`);

  const cookie = await login();
  const { conversationId } = await getAliceAndConversation();
  console.log('Conversation:', conversationId);

  const socket = io(API, {
    transports: ['websocket'],
    extraHeaders: { Cookie: cookie },
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 5000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  console.log('Connected:', socket.id);

  const baseTime = Date.now();
  for (let i = 0; i < COUNT; i++) {
    const payload = {
      conversationId,
      clientId: crypto.randomUUID(),
      kind: 'text' as const,
      body: `Pagination test #${i + 1} — sent ${new Date(baseTime + i * 1000).toISOString()}`,
    };
    const ack = await emitWithAck<{ ok: boolean }>(socket, 'message:send', payload);
    if (!ack.ok) {
      console.error(`Failed at message ${i + 1}`);
      process.exit(1);
    }
    if ((i + 1) % 10 === 0 || COUNT <= 10) console.log(`  Sent ${i + 1}/${COUNT}`);
  }

  socket.disconnect();
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error('ERROR:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());