import { describe, expect, it } from 'vitest';
import { startConversationSchema } from './schemas';

const USER_ID = '123e4567-e89b-12d3-a456-426614174000';

describe('startConversationSchema', () => {
  it('accepts a UUID userId', () => {
    expect(startConversationSchema.safeParse({ userId: USER_ID }).success).toBe(true);
  });

  it('rejects a non-UUID userId', () => {
    expect(startConversationSchema.safeParse({ userId: 'nope' }).success).toBe(false);
  });

  it('rejects a missing userId', () => {
    expect(startConversationSchema.safeParse({}).success).toBe(false);
  });
});
