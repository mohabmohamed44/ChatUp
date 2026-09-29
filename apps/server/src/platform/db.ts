import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import type { Prisma } from '../generated/prisma/client';
import { config } from './config';

export type Db = PrismaClient;

/**
 * The client handed to `$transaction` callbacks. Any helper that may run either
 * on the pool client or inside a transaction should type its parameter as `Tx`,
 * because a full `Db` is structurally assignable to it (it only lacks the
 * transaction/connection management methods).
 */
export type Tx = Prisma.TransactionClient;

export function createDb(): Db {
  const adapter = new PrismaPg({ connectionString: config.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: config.isDev ? ['warn', 'error'] : ['error'],
  });
}
