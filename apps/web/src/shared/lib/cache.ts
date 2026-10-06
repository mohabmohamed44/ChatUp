import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Message, ConversationSummary } from '@chatup/shared';

interface ChatUpDB extends DBSchema {
  messages: {
    key: string;
    value: Message & { _conversationId: string };
    indexes: { byConversation: string };
  };
  conversations: {
    key: string;
    value: ConversationSummary & { _cachedAt: number };
  };
  meta: {
    key: string;
    value: { key: string; value: unknown };
  };
}

const DB_NAME = 'chatup-cache';
const DB_VERSION = 1;

const MAX_MESSAGES_PER_CONVERSATION = 100;
const MAX_CONVERSATIONS = 100;
const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

let dbPromise: Promise<IDBPDatabase<ChatUpDB>> | null = null;

function getDB(): Promise<IDBPDatabase<ChatUpDB>> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available'));
  }
  if (!dbPromise) {
    dbPromise = openDB<ChatUpDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('messages')) {
          const store = db.createObjectStore('messages', { keyPath: 'id' });
          store.createIndex('byConversation', '_conversationId');
        }
        if (!db.objectStoreNames.contains('conversations')) {
          db.createObjectStore('conversations', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      },
    }).catch((err) => {
      console.warn('[cache] IndexedDB unavailable', err);
      throw err;
    });
  }
  return dbPromise;
}

export async function cacheMessages(
  conversationId: string,
  messages: Message[],
): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction('messages', 'readwrite');
    const toCache = messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
    await Promise.all(
      toCache.map((m) => tx.store.put({ ...m, _conversationId: conversationId })),
    );
    await tx.done;
  } catch (err) {
    console.warn('[cache] cacheMessages failed', err);
  }
}

export async function getCachedMessages(
  conversationId: string,
): Promise<Message[]> {
  try {
    const db = await getDB();
    const rows = await db.getAllFromIndex('messages', 'byConversation', conversationId);
    return rows
      .sort((a, b) => Number(a.sequence) - Number(b.sequence))
      .map(({ _conversationId, ...rest }) => rest as Message);
  } catch {
    return [];
  }
}

export async function deleteCachedMessage(messageId: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete('messages', messageId);
  } catch {
    // ignore
  }
}

/** Backwards-compat alias for the previous name. */
export async function deleteMessageFromCache(messageId: string): Promise<void> {
  return deleteCachedMessage(messageId);
}

export async function cacheConversations(
  conversations: ConversationSummary[],
): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction('conversations', 'readwrite');
    const sorted = [...conversations].sort((a, b) =>
      b.lastActivityAt.localeCompare(a.lastActivityAt),
    );
    const toCache = sorted.slice(0, MAX_CONVERSATIONS);
    await Promise.all(toCache.map((c) => tx.store.put({ ...c, _cachedAt: Date.now() })));
    await tx.done;
  } catch (err) {
    console.warn('[cache] cacheConversations failed', err);
  }
}

export async function getCachedConversations(): Promise<ConversationSummary[]> {
  try {
    const db = await getDB();
    const rows = await db.getAll('conversations');
    return rows
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
      .map(({ _cachedAt, ...rest }) => rest as ConversationSummary);
  } catch {
    return [];
  }
}

export async function clearCache(): Promise<void> {
  try {
    const db = await getDB();
    await Promise.all([db.clear('messages'), db.clear('conversations'), db.clear('meta')]);
  } catch {
    // ignore
  }
}

export async function pruneOldData(): Promise<void> {
  try {
    const db = await getDB();
    const cutoff = Date.now() - PRUNE_AFTER_MS;
    const convs = await db.getAll('conversations');
    const tx = db.transaction('conversations', 'readwrite');
    for (const c of convs) {
      if (c._cachedAt < cutoff) await tx.store.delete(c.id);
    }
    await tx.done;
  } catch {
    // ignore
  }
}

// Meta - misc key/value storage

export async function setMeta<T>(key: string, value: T): Promise<void> {
    try {
        const db = await getDB();
        await db.put('meta', { key, value });
    } catch(error) {
        console.warn('[cache] setMeta failed', key, error);
    }
}

export async function getMeta<T>(key: string): Promise<T | null> {
    try {
        const db = await getDB();
        const row = await db.get('meta', key);
        return row ? (row.value as T) : null;
    } catch {
        return null;
    }
}

export async function deletMeta(key: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete('meta', key);
  } catch {
    // pass
  }
}

export async function deleteMeta(key: string): Promise<void> {
  return deletMeta(key);
}

// helper functions for Meta
const META_USER_ID = 'userId';
const META_LAST_CONVERSATION = 'lastConversationId';
const META_LAST_SYNC = 'lastSyncAt';

export async function setCachedUserId(userId: string): Promise<void> {
  await setMeta(META_USER_ID, userId);
}

export async function getCachedUserId(): Promise<string | null> {
  return getMeta<string>(META_USER_ID);
}

export async function setLastOpenedConversation(
  conversationId: string,
): Promise<void> {
  await setMeta(META_LAST_CONVERSATION, conversationId);
}

export async function getLastOpenedConversation(): Promise<string | null> {
  return getMeta<string>(META_LAST_CONVERSATION);
}

export async function setLastSyncAt(timestamp: number): Promise<void> {
  await setMeta(META_LAST_SYNC, timestamp);
}

export async function getLastSyncAt(): Promise<number | null> {
  return getMeta<number>(META_LAST_SYNC);
}