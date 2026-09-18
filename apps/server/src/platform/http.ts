import cookie from 'cookie';
import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response, type Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { ZodError } from 'zod';
import helmet from 'helmet';
import type { Db } from './db';
import { AppError, Errors } from './errors';
import type { AppConfig } from './config';
import type { Logger } from './logger';

interface CreateHttpAppOptions {
  config: AppConfig;
  logger: Logger;
  db: Db;
  routers: Router[];
}

export function createHttpApp({ config, logger, db, routers }: CreateHttpAppOptions): Express {
  const app = express();

  app.disable('x-powered-by');
  if (config.isProd) {
    app.set('trust proxy', 1);
  }

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(
    pinoHttp({
      logger,
      redact: {
        paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
        censor: '[redacted]',
      },
    }),
  );
  app.use(express.json({ limit: '64kb' }));
  app.use(((req: Request, _res: Response, next: NextFunction) => {
    req.cookies = cookie.parse(req.headers.cookie ?? '');
    next();
  }) as RequestHandler);

  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/readyz', async (req, res) => {
    try {
      await db.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', checks: { database: 'ok' } });
    } catch {
      logger.warn('Readiness check failed: database unreachable');
      res.status(503).json({ status: 'degraded', checks: { database: 'error' } });
    }
  });

  for (const router of routers) {
    app.use('/api', router);
  }

  return app;
}

/**
 * Registers the catch-all 404 and error handlers. Must run after every router
 * has been attached, otherwise routes mounted later would fall through to the
 * 404 handler.
 */
export function attachErrorHandling(app: Express, logger: Logger): void {
  app.use(() => {
    throw Errors.notFound('Route');
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.status).json({
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
        },
      });
      return;
    }
    if (err instanceof ZodError) {
      res.status(422).json({
        error: {
          code: 'validation_error',
          message: 'Request validation failed',
          details: err.issues,
        },
      });
      return;
    }
    if (
      typeof err === 'object' &&
      err !== null &&
      'type' in err &&
      (err as { type?: string }).type === 'entity.parse.failed'
    ) {
      res.status(400).json({ error: { code: 'bad_request', message: 'Invalid JSON body' } });
      return;
    }
    logger.error({ err }, 'Unhandled request error');
    res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong' } });
  });
}
