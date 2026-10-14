// ChatUp production load test (k6) — TypeScript source.
//
// k6 cannot run TS directly, so this compiles to JS via esbuild:
//   npm run load:bundle   # → load-test/k6/dist/chatup.load.js (gitignored)
//   npm run load:smoke    # 5 VUs, ~1 min, against K6_BASE_URL (default localhost:4000)
//   npm run load          # 100 VUs, 10 min sustained — the AGENTS.md §9 gate
//
// Target: K6_BASE_URL must point at the DEPLOYED assessment env (Cloud Run URL),
// never at a DB with real user data. Synthetic load users/sessions come from
// `npm run load:seed` → load-test/.sessions.json (gitignored, seeded per target DB).
// Optional env: K6_PROFILE=smoke|full (default smoke), K6_RUN_ID (default
// k6-<timestamp>, prefixes every clientId so runs never collide),
// K6_SESSIONS_FILE (absolute path if the bundle moved), K6_DEBUG=1 (per-packet logs).
//
// Why pre-seeded sessions: /auth/register + /auth/login are rate-limited to
// 20 req / 15 min / IP (authLimiter), so 100 VUs cannot log in live. Seeding
// bypasses auth endpoints entirely; every VU reuses one session cookie +
// x-csrf-token pair. GETs need only the cookie; unsafe HTTP methods would also
// need the CSRF header (auth.middleware.ts) — sends go over the socket.
//
// Why Engine.IO polling (not websocket): k6 has no Socket.IO client. The
// Engine.IO polling transport is plain HTTP, so message:send + acks + broadcasts
// are scriptable with k6/http. Packet grammar (Engine.IO v4 + Socket.IO v5):
//   handshake:  GET  /socket.io/?EIO=4&transport=polling          → 0{"sid":"…",…}
//   connect:    POST …&transport=polling&sid=…  body "40"          → poll returns 40
//   emit+ack:   POST body 42<ackId>["message:send",{…}]            → poll returns 43<ackId>[{…}]
//   broadcasts: poll returns 42["message:new",{…}] (partner VU's messages = fan-out proof)
// Polling requests bypass the Express 300 req/min global limiter (it is Express
// middleware; Engine.IO answers before Express). REST calls are paced to stay
// well under it (~150/min at full load).
//
// Reported evidence (AGENTS.md §9): k6 prints p50/p95 per tagged request
// (kind=api vs kind=eio), http_req_failed rate, plus custom counters below for
// sends, ack latency, idempotent retries, missing/dupes. Capture server CPU/mem
// during the run with: docker stats --no-stream (compose) or Cloud Run charts.

import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

interface LoadSession {
  userId: string;
  email: string;
  conversationId: string;
  token: string;
  csrfToken: string;
}

interface SetupData {
  baseUrl: string;
  runId: string;
}

const BASE_URL = __ENV.K6_BASE_URL || 'http://localhost:4000';
const PROFILE = __ENV.K6_PROFILE || 'smoke';
const FULL = PROFILE === 'full';
const DEBUG = __ENV.K6_DEBUG === '1';

function dbg(...args: unknown[]): void {
  if (DEBUG) console.log(`[vu${exec.vu.idInTest}]`, ...(args as string[]));
}

// Seeded by `npm run load:seed` against the TARGET database. k6 resolves
// relative open() paths against the BUNDLE file, so the default climbs out of
// dist/ (override with an absolute path via K6_SESSIONS_FILE if relocated).
const sessions = new SharedArray<LoadSession>('sessions', () => {
  const path = __ENV.K6_SESSIONS_FILE || '../../.sessions.json';
  return JSON.parse(open(path)) as LoadSession[];
});

const sendsOk = new Counter('chatup_sends_ok');
const sendsFailed = new Counter('chatup_sends_failed');
const ackLatency = new Trend('chatup_ack_latency_ms');
const idempotentOk = new Counter('chatup_idempotent_retry_ok');
const idempotentMismatch = new Counter('chatup_idempotent_mismatch');
const historyMissing = new Counter('chatup_history_missing');
const historyDupes = new Counter('chatup_history_duplicates');
const broadcasts = new Counter('chatup_broadcasts_received');
const eioReconnects = new Counter('chatup_eio_reconnects');

export const options = {
  scenarios: {
    chat: {
      executor: 'constant-vus',
      vus: FULL ? 100 : 5,
      duration: FULL ? '10m' : '1m',
    },
  },
  thresholds: {
    'http_req_duration{kind:api}': ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    // Ack waits for the persist pipeline (queue worker or sync fallback), so this
    // threshold measures persistence latency, not just socket round-trip.
    chatup_ack_latency_ms: ['p(95)<5000'],
    chatup_sends_failed: ['count==0'],
    chatup_idempotent_mismatch: ['count==0'],
    chatup_history_missing: ['count==0'],
    chatup_history_duplicates: ['count==0'],
  },
};

export function setup(): SetupData {
  if (sessions.length === 0) {
    throw new Error('No load sessions — run `npm run load:seed` against K6 target DB first.');
  }
  const runId = __ENV.K6_RUN_ID || `k6-${Date.now()}`;
  const health = http.get(`${BASE_URL}/health`, { tags: { kind: 'api' } });
  check(health, { 'target live': (r) => r.status === 200 });
  return { baseUrl: BASE_URL, runId };
}

// ---- Engine.IO polling transport (per-VU state; VU globals persist across iterations) ----

interface EioState {
  sid: string;
  ackId: number;
}

let eio: EioState | null = null;
let vuSeq = 0;
let recentClientIds: string[] = [];

// Auth + transport cookies (chatup_session, engine.io `io`, Cloud Run affinity)
// ride in the VU cookie jar, which refreshes them on every handshake. A manual
// Cookie header would go stale across reconnects and get polling sessions
// closed — so requests below set NO Cookie header; the jar does it all.
function seedJar(baseUrl: string, s: LoadSession): void {
  http.cookieJar().set(baseUrl, 'chatup_session', s.token);
  if (DEBUG) {
    const names = Object.keys(http.cookieJar().cookiesForURL(baseUrl));
    dbg(`seedJar ${s.email} jar=[${names.join(',')}]`);
  }
}

// Engine.IO v4 polling framing: packets joined by \x1e (record separator).
// (Control chars inside JSON strings arrive \u-escaped, so a raw split is safe.)
function decodePayloads(body: string): string[] {
  return body.split('\x1e').filter((p) => p.length > 0);
}

function eioUrl(baseUrl: string, sid?: string): string {
  return `${baseUrl}/socket.io/?EIO=4&transport=polling${sid ? `&sid=${sid}` : ''}`;
}

function eioConnect(baseUrl: string, s: LoadSession): boolean {
  seedJar(baseUrl, s);
  const hs = http.get(eioUrl(baseUrl), { tags: { kind: 'eio' } });
  if (hs.status !== 200 || !hs.body || typeof hs.body !== 'string' || !hs.body.startsWith('0{')) {
    return false;
  }
  let sid = '';
  try {
    sid = (JSON.parse(hs.body.slice(1)) as { sid: string }).sid;
  } catch {
    return false;
  }
  if (!sid) return false;
  eio = { sid, ackId: 0 };
  const conn = http.post(eioUrl(baseUrl, sid), '40', {
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    tags: { kind: 'eio' },
  });
  if (conn.status !== 200) {
    eio = null;
    return false;
  }
  // Drain the connect confirmation before emitting: Engine.IO closes a polling
  // session that receives data packets while no poll has completed (server
  // answers later polls with "Session ID unknown").
  const drain = http.get(eioUrl(baseUrl, sid), { timeout: '30s', tags: { kind: 'eio' } });
  if (
    drain.status !== 200 ||
    typeof drain.body !== 'string' ||
    !decodePayloads(drain.body).some((p) => p.startsWith('40'))
  ) {
    eio = null;
    return false;
  }
  return true;
}

interface EmitResult {
  ok: boolean;
  messageId: string | null;
}

// Slice the first balanced JSON array starting at `from`. Poll batches are not
// always \x1e-separated, so a prefix-matched packet can carry trailing packets
// — never JSON.parse the raw tail.
function extractJsonArray(p: string, from: number): unknown {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = from; i < p.length; i++) {
    const c = p[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return JSON.parse(p.slice(from, i + 1));
    }
  }
  throw new Error('unbalanced JSON array');
}

// Emits message:send and waits for the Socket.IO ack (43<ackId>[…]).
// Public send: try once, and on ANY failure retry once with the SAME clientId
// on a fresh session. The (conversationId, senderId, clientId) unique
// constraint turns a double-persist into a dedupe (idempotency proof), so a
// retry can never create a duplicate — mirroring the app's own failed-send
// retry button (useSendMessage).
function emitSend(
  baseUrl: string,
  s: LoadSession,
  payload: Record<string, unknown>,
  seq: number,
): EmitResult {
  const first = attemptEmit(baseUrl, s, payload, seq);
  if (first.ok) return first;
  eioReconnects.add(1);
  return attemptEmit(baseUrl, s, payload, seq);
}

function attemptEmit(
  baseUrl: string,
  s: LoadSession,
  payload: Record<string, unknown>,
  seq: number,
): EmitResult {
  if (!eio && !eioConnect(baseUrl, s)) {
    eioReconnects.add(1);
    return { ok: false, messageId: null };
  }
  const ackId = (eio as EioState).ackId++;
  const packet = `42${ackId}["message:send",${JSON.stringify(payload)}]`;
  const t0 = Date.now();
  const post = http.post(eioUrl(baseUrl, (eio as EioState).sid), packet, {
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    tags: { kind: 'eio' },
  });
  if (post.status !== 200) {
    eio = null;
    return { ok: false, messageId: null };
  }
  // The ack trails the persist pipeline (message:new, then conversation:updated,
  // then the 43<ackId> ack ~1-2s later), so wait on a deadline, not a poll
  // count: under fan-out traffic polls return instantly with other VUs'
  // broadcasts and a fixed poll budget exits before the ack lands.
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const poll = http.get(eioUrl(baseUrl, (eio as EioState).sid), {
      timeout: '30s',
      tags: { kind: 'eio' },
    });
    if (poll.status !== 200 || typeof poll.body !== 'string') {
      dbg(`seq ${seq} emit ${ackId}: poll status=${poll.status} → drop session`);
      eio = null;
      return { ok: false, messageId: null };
    }
    for (const p of decodePayloads(poll.body)) {
      dbg(`seq ${seq} emit ${ackId}: packet ${p.slice(0, 60)}`);
      if (p.startsWith('42["message:new"')) broadcasts.add(1);
      if (p === '1') {
        dbg(`seq ${seq} emit ${ackId}: got close packet → drop session`);
        eio = null;
        return { ok: false, messageId: null };
      }
      if (p.startsWith(`43${ackId}[`)) {
        dbg(`seq ${seq} emit ${ackId}: ACK MATCH plen=${p.length}`);
        try {
          const result = (
            extractJsonArray(p, 2 + String(ackId).length) as Array<{
              ok: boolean;
              data?: { id: string };
            }>
          )[0];
          dbg(`seq ${seq} emit ${ackId}: ack parsed ok=${result && result.ok}`);
          if (result && result.ok) {
            ackLatency.add(Date.now() - t0);
            return { ok: true, messageId: (result.data && result.data.id) || null };
          }
          return { ok: false, messageId: null };
        } catch (e) {
          dbg(
            `seq ${seq} emit ${ackId}: ack parse threw ${(e as Error).message} tail=${p.slice(-40)}`,
          );
          return { ok: false, messageId: null };
        }
      }
    }
    sleep(0.15);
  }
  return { ok: false, messageId: null };
}

// History check (paced — REST counts toward the 300 req/min global limiter).
// Walks up to 5 pages (Page<T> = { items, nextCursor }) following `before`.
function verifyHistory(baseUrl: string, s: LoadSession, want: string[]): void {
  let before: string | null = null;
  let found = 0;
  let dupes = 0;
  const wantSet = new Set(want);
  for (let page = 0; page < 5 && found < wantSet.size; page++) {
    const q = `limit=100${before ? `&before=${encodeURIComponent(before)}` : ''}`;
    const res = http.get(`${baseUrl}/api/conversations/${s.conversationId}/messages?${q}`, {
      tags: { kind: 'api' },
    });
    if (res.status !== 200 || typeof res.body !== 'string') {
      sendsFailed.add(1);
      if (DEBUG) {
        const names = Object.keys(http.cookieJar().cookiesForURL(baseUrl));
        dbg(`history status=${res.status} jar=[${names.join(',')}]`);
      }
      return;
    }
    let items: Array<{ clientId?: string; id?: string }> = [];
    let next: string | null = null;
    try {
      const page = JSON.parse(res.body) as {
        items: Array<{ clientId?: string; id?: string }>;
        nextCursor: string | null;
      };
      items = page.items || [];
      next = page.nextCursor;
    } catch {
      sendsFailed.add(1);
      return;
    }
    const seen = new Set<string>();
    for (const m of items) {
      if (!m.clientId) continue;
      if (seen.has(m.clientId)) dupes++;
      seen.add(m.clientId);
      if (wantSet.has(m.clientId)) found++;
    }
    if (!next) break;
    before = next;
  }
  if (found < wantSet.size) historyMissing.add(wantSet.size - found);
  if (dupes > 0) historyDupes.add(dupes);
}

export default function (data: SetupData): void {
  const s = sessions[(exec.vu.idInTest - 1) % sessions.length] as LoadSession;
  seedJar(data.baseUrl, s);
  const seq = vuSeq++;
  const clientId = `${data.runId}:vu${exec.vu.idInTest}:${seq}`;
  const payload = {
    conversationId: s.conversationId,
    clientId,
    kind: 'TEXT',
    body: `load ${data.runId} #${seq} from ${s.email}`,
  };

  const res = emitSend(data.baseUrl, s, payload, seq);
  check(res, { 'send acked': (r) => (r as EmitResult).ok });
  if (res.ok) {
    sendsOk.add(1);
    recentClientIds.push(clientId);
    if (recentClientIds.length > 200) recentClientIds = recentClientIds.slice(-200);
  } else {
    sendsFailed.add(1);
  }

  // Idempotency proof: same clientId retried must return the WINNER row, not a dupe.
  if (res.ok && seq % 20 === 0) {
    const retry = emitSend(data.baseUrl, s, payload, seq);
    if (retry.ok && retry.messageId === res.messageId) idempotentOk.add(1);
    else idempotentMismatch.add(1);
  }

  // Paced REST coverage: history every ~24 sends (~26s per VU at full load →
  // ~230 req/min across 100 VUs, under the 300 req/min global limiter),
  // conversation list + /auth/me every ~96.
  if (seq % 24 === 0) {
    verifyHistory(data.baseUrl, s, recentClientIds.slice(-15));
    if (seq % 96 === 0) {
      http.get(`${baseUrl}/api/conversations`, { tags: { kind: 'api' } });
      http.get(`${baseUrl}/api/auth/me`, { tags: { kind: 'api' } });
    }
  }

  sleep(0.5 + Math.random());
}
