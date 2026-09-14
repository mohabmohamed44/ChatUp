import {
  LIMITS,
  PRESENCE_EVENTS,
  SOCKET_ROOMS,
  type PresenceStatus,
  type PresenceUpdate,
} from '@chatup/shared';
import type { Db } from '../../platform/db';
import type { Logger } from '../../platform/logger';
import type { ChatIo } from '../../realtime/io';

export class PresenceService {
  private readonly connections = new Map<string, Set<string>>();
  private readonly offlineTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private io: ChatIo | null = null;

  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  bind(io: ChatIo): void {
    this.io = io;
  }

  isOnline(userId: string): boolean {
    return this.connections.has(userId);
  }

  getSnapshot(userIds: string[]): Record<string, PresenceStatus> {
    const snapshot: Record<string, PresenceStatus> = {};
    for (const userId of userIds) {
      snapshot[userId] = this.isOnline(userId) ? 'online' : 'offline';
    }
    return snapshot;
  }

  async onConnect(userId: string, socketId: string): Promise<void> {
    const wasOffline = !this.connections.has(userId);
    const sockets = this.connections.get(userId) ?? new Set<string>();
    sockets.add(socketId);
    this.connections.set(userId, sockets);

    const pendingOffline = this.offlineTimers.get(userId);
    if (pendingOffline) {
      clearTimeout(pendingOffline);
      this.offlineTimers.delete(userId);
    }

    if (wasOffline) {
      await this.notifyPartners(userId, 'online');
    }
  }

  onDisconnect(userId: string, socketId: string): void {
    const sockets = this.connections.get(userId);
    if (!sockets) return;
    sockets.delete(socketId);
    if (sockets.size > 0) return;

    this.connections.delete(userId);
    const timer = setTimeout(() => {
      this.offlineTimers.delete(userId);
      if (!this.connections.has(userId)) {
        void this.notifyPartners(userId, 'offline');
      }
    }, LIMITS.PRESENCE_GRACE_MS);
    this.offlineTimers.set(userId, timer);
  }

  async stop(): Promise<void> {
    for (const timer of this.offlineTimers.values()) {
      clearTimeout(timer);
    }
    this.offlineTimers.clear();
  }

  private async notifyPartners(userId: string, status: PresenceStatus): Promise<void> {
    if (!this.io) return;
    try {
      const rows = await this.db.conversationParticipant.findMany({
        where: { userId },
        select: { conversation: { select: { participants: { select: { userId: true } } } } },
      });
      const partnerIds = new Set<string>();
      for (const row of rows) {
        for (const participant of row.conversation.participants) {
          if (participant.userId !== userId) partnerIds.add(participant.userId);
        }
      }
      if (partnerIds.size === 0) return;
      const update: PresenceUpdate = { userId, status, at: new Date().toISOString() };
      for (const partnerId of partnerIds) {
        this.io.to(SOCKET_ROOMS.user(partnerId)).emit(PRESENCE_EVENTS.update, update);
      }
    } catch (err) {
      this.logger.warn({ err, userId }, 'Failed to notify presence partners');
    }
  }
}
