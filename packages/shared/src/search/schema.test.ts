import { describe, expect, it } from 'vitest';
import { searchConversationsSchema, searchMessageSchema } from './schema';

describe('searchMessageSchema', () => {
  it('accepts a query and defaults the limit to 20', () => {
    const result = searchMessageSchema.safeParse({ q: 'hello' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(20);
  });

  it('rejects a query shorter than 2 chars', () => {
    expect(searchMessageSchema.safeParse({ q: 'a' }).success).toBe(false);
  });

  it('coerces a string limit', () => {
    const result = searchMessageSchema.safeParse({ q: 'hello', limit: '5' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(5);
  });

  it('rejects a limit above 50', () => {
    expect(searchMessageSchema.safeParse({ q: 'hello', limit: 51 }).success).toBe(false);
  });

  it('coerces date filters', () => {
    const result = searchMessageSchema.safeParse({ q: 'hello', after: '2024-01-01' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.after).toBeInstanceOf(Date);
  });
});

describe('searchConversationsSchema', () => {
  it('accepts an empty filter set with a default limit', () => {
    const result = searchConversationsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(20);
  });

  it('rejects a single-char query', () => {
    expect(searchConversationsSchema.safeParse({ q: 'x' }).success).toBe(false);
  });
});
