'use client';

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

interface DraftDB extends DBSchema {
    voiceDrafts: {
        key: string;
        value: {
            conversationId: string;
            blob: Blob;
            mimeType: string;
            durationMs: number;
            createdAt: number;
        };
    };
}


let dbPromise: Promise<IDBPDatabase<DraftDB>> | null = null;

// Lazily opened: the previous top-level `openDB(...)` ran at module import,
// including during Next.js server prerender where `indexedDB` is undefined,
// which left a rejected/shared promise and writes that never landed.
function getDB(): Promise<IDBPDatabase<DraftDB>> {
    if (typeof indexedDB === 'undefined') {
        return Promise.reject(new Error('IndexedDB is not available'));
    }
    if (!dbPromise) {
        dbPromise = openDB<DraftDB>('chatup-drafts', 1, {
            upgrade(db) {
                db.createObjectStore('voiceDrafts', {keyPath: 'conversationId' });
            },
        });
    }
    return dbPromise;
}

export async function saveVoiceDraft(
    conversationId: string,
    blob: Blob,
    mimeType: string,
    durationMs: number,
  ): Promise<void> {
    const db = await getDB();
    await db.put('voiceDrafts', {
        conversationId,
        blob,
        mimeType,
        durationMs,
        createdAt: Date.now(),
    });
}  

export async function getVoiceDraft(conversationId: string) {
    const db = await getDB();
    return db.get('voiceDrafts', conversationId);
}

export async function clearVoiceDraft(conversationId: string): Promise<void> {
    const db = await getDB();
    await db.delete('voiceDrafts', conversationId);
}

export async function listVoiceDrafts() {
    const db = await getDB();
    return db.getAll('voiceDrafts');
}