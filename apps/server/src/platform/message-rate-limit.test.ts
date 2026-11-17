import { describe, expect, it } from 'vitest';
import { MESSAGE_RATE_LIMIT, allowMessageSend, memoryCheck } from './message-rate-limit';

// Note: memoryCheck keeps module-level state, so every test uses its own
// user ids to stay independent.

describe('memoryCheck (in-memory fallback)', () => {
  it('allows up to MAX_PER_WINDOW messages, then rejects', () => {
    const now = 1_000_000;
    for (let i = 0; i < MESSAGE_RATE_LIMIT.MAX_PER_WINDOW; i++) {
      expect(memoryCheck('limit-user-a', now)).toBe(true);
    }
    expect(memoryCheck('limit-user-a', now)).toBe(false);
    expect(memoryCheck('limit-user-a', now)).toBe(false);
  });

  it('resets on the next window', () => {
    const base =
      Math.floor(2_000_000 / MESSAGE_RATE_LIMIT.WINDOW_MS) * MESSAGE_RATE_LIMIT.WINDOW_MS;
    for (let i = 0; i < MESSAGE_RATE_LIMIT.MAX_PER_WINDOW; i++) {
      expect(memoryCheck('limit-user-b', base)).toBe(true);
    }
    expect(memoryCheck('limit-user-b', base)).toBe(false);
    // One millisecond past the window boundary: fresh budget.
    expect(memoryCheck('limit-user-b', base + MESSAGE_RATE_LIMIT.WINDOW_MS)).toBe(true);
  });

  it('keys by user, not globally', () => {
    const now = 3_000_000;
    for (let i = 0; i < MESSAGE_RATE_LIMIT.MAX_PER_WINDOW; i++) {
      expect(memoryCheck('limit-user-c', now)).toBe(true);
    }
    expect(memoryCheck('limit-user-c', now)).toBe(false);
    expect(memoryCheck('limit-user-d', now)).toBe(true);
  });
});

describe('allowMessageSend', () => {
  it('enforces the per-user cap over Redis or the in-memory fallback', async () => {
    for (let i = 0; i < MESSAGE_RATE_LIMIT.MAX_PER_WINDOW; i++) {
      expect(await allowMessageSend('allow-user-test')).toBe(true);
    }
    expect(await allowMessageSend('allow-user-test')).toBe(false);
    expect(await allowMessageSend('allow-user-other')).toBe(true);
  });
});
