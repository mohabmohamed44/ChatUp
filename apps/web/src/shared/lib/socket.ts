import {io, type Socket} from 'socket.io-client';

import type {
    ClientToServerEvents,
    ServerToClientEvents,
} from "@chatup/shared";

// Singleton pattern is a design pattern that 
// ensures a class has only one instance and provides a global point of access to it.

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const socketURL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

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
            transports: ["websocket", "polling"],
        })
    }
    return socket as ChatSocket;
}