export type ISODateString = string;

export type Ack<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
