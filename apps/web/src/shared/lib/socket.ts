import { io, type Socket } from 'socket.io-client';

import type { ClientToServerEvents, ServerToClientEvents } from '@chatup/shared';

// Singleton pattern is a design pattern that
// ensures a class has only one instance and provides a global point of access to it.

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// SOCKET_URL is the browser-reachable address; API_URL is the address the web
// container itself uses (Next rewrites proxy /api server-side). They differ in
// Docker (browser → localhost:4000, container → http://server:4000).
const socketURL =
  process.env.NEXT_PUBLIC_SOCKET_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

let socket: ChatSocket | null = null;

export function getSocket(): ChatSocket {
  if (!socket) {
    socket = io(socketURL, {
      withCredentials: true,
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      transports: ['websocket', 'polling'],
    });
  }
  return socket as ChatSocket;
}
