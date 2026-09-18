/**
 * Verifies delivery-receipt invariants against forged socket payloads:
 *   A. self-receipt  — acking your own message with a forged senderId
 *   B. cross-conversation — acking a message via a conversation you are not in
 *   C. legitimate    — the other participant acking your message still works
 */

import { io, type Socket } from 'socket.io-client';
import { createDb } from '../src/platform/db';

const API = 'http://localhost:4000';

const db = createDb();

async function login(email: string): Promise<string> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!' }),
  });
  if (!res.ok) throw new Error(`login failed for ${email}: ${res.status}`);
  const cookie = res.headers
    .getSetCookie()
    .map((value) => value.split(';')[0]?.trim() ?? '')
    .find((value) => value.startsWith('chatup_session='));
  if (!cookie) throw new Error(`no session cookie for ${email}`);
  return cookie;
}

function connect(cookie: string): Promise<Socket> {
  const socket = io(API, { transports: ['websocket'], extraHeaders: { Cookie: cookie } });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 5000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function ackMessage(socket: Socket, payload: unknown): Promise<void> {
  return new Promise((resolve) => {
    socket.emit('message:new', payload, () => resolve());
  });
}

async function main(): Promise<void> {
  const alice = await db.user.findUniqueOrThrow({
    where: { email: 'alice@chatup.dev' },
    select: { id: true },
  });
  const bob = await db.user.findUniqueOrThrow({
    where: { email: 'bob@chatup.dev' },
    select: { id: true },
  });

  const participation = await db.conversationParticipant.findFirst({
    where: { userId: alice.id },
    select: { conversationId: true },
  });
  if (!participation) throw new Error('Alice has no conversation');
  const conversationId = participation.conversationId;

  const ownMessage = await db.message.findFirst({
    where: { conversationId, senderId: alice.id },
    select: { id: true },
  });
  if (!ownMessage) throw new Error('No message sent by Alice');

  await db.messageReceipt.deleteMany({ where: { messageId: ownMessage.id } });

  const aliceSocket = await connect(await login('alice@chatup.dev'));
  const bobSocket = await connect(await login('bob@chatup.dev'));

  // A: Alice acks her own message with a forged senderId that bypasses the
  //    caller-level guard in messages.routes.ts.
  await ackMessage(aliceSocket, {
    message: { id: ownMessage.id, conversationId, senderId: bob.id },
  });

  // B: Alice acks via a conversation she is not a member of (id guessed).
  await ackMessage(aliceSocket, {
    message: { id: ownMessage.id, conversationId: crypto.randomUUID(), senderId: bob.id },
  });

  await new Promise((resolve) => setTimeout(resolve, 600));

  // C: Bob legitimately acks Alice's message.
  await ackMessage(bobSocket, {
    message: { id: ownMessage.id, conversationId, senderId: alice.id },
  });
  await new Promise((resolve) => setTimeout(resolve, 600));

  const selfReceipts = await db.messageReceipt.count({
    where: { messageId: ownMessage.id, userId: alice.id },
  });
  const bobReceipt = await db.messageReceipt.findUnique({
    where: { messageId_userId: { messageId: ownMessage.id, userId: bob.id } },
  });

  aliceSocket.disconnect();
  bobSocket.disconnect();

  console.log('A+B self-receipts for Alice on her own message:', selfReceipts, '(expected 0)');
  console.log('C   legitimate receipt for Bob:', bobReceipt ? 'created' : 'MISSING', '(expected created)');

  const passed = selfReceipts === 0 && bobReceipt !== null;
  console.log(passed ? 'PASS' : 'FAIL');
  process.exit(passed ? 0 : 1);
}

main()
  .catch((err) => {
    console.error('ERROR:', err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
