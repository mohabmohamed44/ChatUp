import { io, type Socket } from 'socket.io-client';

import { LIMITS, type ClientToServerEvents, type ServerToClientEvents } from '@chatup/shared';

// Singleton pattern is a design pattern that
// ensures a class has only one instance and provides a global point of access to it.

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// SOCKET_URL is the browser-reachable address; API_URL is the address the web
// container itself uses (Next rewrites proxy /api server-side). They differ in
// Docker (browser → localhost:4000, container → http://server:4000).
const socketURL =
  process.env.NEXT_PUBLIC_SOCKET_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

let socket: ChatSocket | null = null;

function readCsrfCookie(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const entry = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${LIMITS.CSRF_COOKIE_NAME}=`));
  return entry?.slice(LIMITS.CSRF_COOKIE_NAME.length + 1);
}

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
      // Cross-domain sockets never carry the HttpOnly session cookie (it
      // belongs to the web domain), so authenticate the handshake with the
      // readable CSRF cookie value instead. Evaluated per handshake, so
      // logins/logouts/rotations are picked up without recreating the socket.
      auth: (cb) => {
        cb({ csrfToken: readCsrfCookie() });
      },
    });

    // Back/Forward Cache: Chrome (149+) may put the page in bfcache even with
    // an open WebSocket. The socket dies while cached and restoration before a
    // fresh handshake can surface console errors / stale-state reconnects.
    // The socket never authenticates mid-freeze, so proactively disconnect on
    // pagehide; the existing reconnection handles pageshow (persisted or not).
    window.addEventListener('pagehide', () => {
      socket?.disconnect();
    });
    window.addEventListener('pageshow', (event) => {
      if ((event as PageTransitionEvent).persisted) socket?.connect();
    });
  }
  return socket as ChatSocket;
}
