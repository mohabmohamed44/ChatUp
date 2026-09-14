import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { config } from '../src/platform/config';
import { randomBytes, scrypt as scryptCallback, type ScryptOptions } from 'node:crypto';

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: config.DATABASE_URL }),
});

// Promisify scrypt with explicit typing. The default promisify overload
// loses the options parameter, so we wrap it manually.
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

async function hash(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return ['scrypt', 16384, 8, 1, salt.toString('base64'), key.toString('base64')].join('$');
}

async function main(): Promise<void> {
  console.log('Seeding synthetic data...');

  const passwordHash = await hash('Password123!');

  const alice = await db.user.upsert({
    where: { email: 'alice@chatup.dev' },
    update: {},
    create: {
      email: 'alice@chatup.dev',
      passwordHash,
      displayName: 'Alice Demo',
    },
  });

  const bob = await db.user.upsert({
    where: { email: 'bob@chatup.dev' },
    update: {},
    create: {
      email: 'bob@chatup.dev',
      passwordHash,
      displayName: 'Bob Demo',
    },
  });

  const directKey = [alice.id, bob.id].sort().join(':');

  const conversation = await db.conversation.upsert({
    where: { directKey },
    update: {},
    create: {
      directKey,
      participants: {
        create: [{ userId: alice.id }, { userId: bob.id }],
      },
    },
  });

  const existingMessages = await db.message.count({
    where: { conversationId: conversation.id },
  });

  if (existingMessages === 0) {
    const now = Date.now();
    let lastMessageId: string | null = null;
    let lastActivityAt = new Date(now - 12 * 60_000);

    for (let i = 0; i < 12; i++) {
      const sender = i % 2 === 0 ? alice : bob;
      const createdAt = new Date(now - (12 - i) * 60_000);

      const message = await db.message.create({
        data: {
          conversationId: conversation.id,
          senderId: sender.id,
          clientId: `seed-${i}`,
          kind: 'TEXT',
          body: `Synthetic message ${i + 1} from ${sender.displayName}.`,
          createdAt,
        },
      });

      lastMessageId = message.id;
      lastActivityAt = createdAt;
    }

    await db.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageId, lastActivityAt },
    });
  }

  console.log('Seed complete.');
  console.log('Demo accounts:');
  console.log('  alice@chatup.dev / Password123!');
  console.log('  bob@chatup.dev   / Password123!');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());