declare global {
  namespace Express {
    interface Request {
      cookies: Record<string, string>;
      auth?: {
        userId: string;
        sessionId: string;
        csrfToken: string;
      };
    }
  }
}

export {};
