import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { config } from './config';

export type Db = PrismaClient;

export function createDb(): Db {
  const adapter = new PrismaPg({ connectionString: config.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: config.isDev ? ['warn', 'error'] : ['error'],
  });
}
