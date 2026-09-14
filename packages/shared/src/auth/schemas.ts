import { z } from 'zod';
import { LIMITS } from '../constants';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email());

export const registerSchema = z.object({
  email,
  password: z.string().min(LIMITS.PASSWORD_MIN).max(LIMITS.PASSWORD_MAX),
  displayName: z
    .string()
    .trim()
    .min(LIMITS.DISPLAY_NAME_MIN)
    .max(LIMITS.DISPLAY_NAME_MAX),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(LIMITS.PASSWORD_MAX),
});

export const updateProfileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(LIMITS.DISPLAY_NAME_MIN)
    .max(LIMITS.DISPLAY_NAME_MAX),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
