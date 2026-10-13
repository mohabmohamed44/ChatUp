// Minimal ambient declarations for the k6 runtime modules used by chatup.load.ts.
// Editor/type-checker aid only — k6 executes the esbuild bundle, never this file.

declare module 'k6' {
  export function check<T>(val: T, checks: Record<string, (v: T) => boolean>): boolean;
  export function sleep(seconds: number): void;
  export const __ENV: Record<string, string>;
}

declare module 'k6/http' {
  export interface Response {
    status: number;
    body: string | null | unknown;
    headers: Record<string, string>;
  }
  export function get(
    url: string,
    params?: { headers?: Record<string, string>; timeout?: string; tags?: Record<string, string> },
  ): Response;
  export function post(
    url: string,
    body: string,
    params?: { headers?: Record<string, string>; timeout?: string; tags?: Record<string, string> },
  ): Response;
}

declare module 'k6/execution' {
  export const vu: { idInTest: number };
  const exec: { vu: { idInTest: number } };
  export default exec;
}

declare module 'k6/metrics' {
  export class Counter {
    constructor(name: string);
    add(value: number): void;
  }
  export class Trend {
    constructor(name: string);
    add(value: number): void;
  }
}

declare module 'k6/data' {
  export class SharedArray<T> extends Array<T> {
    constructor(name: string, fn: () => T[]);
  }
}

declare function open(path: string): string;
