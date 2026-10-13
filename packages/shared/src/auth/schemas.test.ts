import { describe, expect, it } from 'vitest';
import { LIMITS } from '../constants';
import { loginSchema, registerSchema, updateProfileSchema } from './schemas';

describe('registerSchema', () => {
  it('accepts valid input', () => {
    const result = registerSchema.safeParse({
      email: 'alice@example.com',
      password: 'Password123!',
      displayName: 'Alice',
    });
    expect(result.success).toBe(true);
  });

  it('trims and lowercases the email', () => {
    const result = registerSchema.safeParse({
      email: '  ALICE@Example.COM ',
      password: 'Password123!',
      displayName: 'Alice',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe('alice@example.com');
  });

  it('rejects a malformed email', () => {
    const result = registerSchema.safeParse({
      email: 'not-an-email',
      password: 'Password123!',
      displayName: 'Alice',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a password shorter than PASSWORD_MIN', () => {
    const result = registerSchema.safeParse({
      email: 'alice@example.com',
      password: 'x'.repeat(LIMITS.PASSWORD_MIN - 1),
      displayName: 'Alice',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a blank display name', () => {
    const result = registerSchema.safeParse({
      email: 'alice@example.com',
      password: 'Password123!',
      displayName: '  ',
    });
    expect(result.success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('accepts valid input', () => {
    const result = loginSchema.safeParse({
      email: 'alice@example.com',
      password: 'anything-at-all',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty password', () => {
    const result = loginSchema.safeParse({
      email: 'alice@example.com',
      password: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('updateProfileSchema', () => {
  it('accepts an empty patch (all fields optional)', () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(true);
  });

  it('accepts clearing the avatar via null', () => {
    const result = updateProfileSchema.safeParse({ avatarMediaId: null });
    expect(result.success).toBe(true);
  });

  it('rejects a too-short display name', () => {
    expect(updateProfileSchema.safeParse({ displayName: 'a' }).success).toBe(false);
  });
});
