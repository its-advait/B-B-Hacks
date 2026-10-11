import express, { type ErrorRequestHandler, type Express, type NextFunction, type Request, type Response } from 'express';
import { ApiError } from './errors.js';
import type { LedgerPort } from './ledgerPort.js';
import { redactError } from './redact.js';
import { createSessionService } from './sessions.js';

export interface AppDependencies {
  resolveLedger: () => Promise<LedgerPort>;
  /** Optional directory for public session JSON. It is never reloaded as a live session. */
  publicMetadataDir?: string;
}

const BOUNDED_ID = /^[A-Za-z0-9_-]{1,80}$/;

function sessionId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || !BOUNDED_ID.test(id)) {
    throw new ApiError(400, 'invalid_body', 'Session id must be a bounded id.');
  }
  return id;
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  res.status(500).json({ error: { code: 'internal', message: redactError(error) } });
}

function asyncHandler(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

function isPayloadTooLarge(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const record = error as { status?: unknown; type?: unknown };
  return record.status === 413 || record.type === 'entity.too.large';
}

const jsonErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ error: { code: 'invalid_body', message: 'Request body must be JSON.' } });
    return;
  }
  if (isPayloadTooLarge(error)) {
    res.status(400).json({ error: { code: 'invalid_body', message: 'Request body is too large.' } });
    return;
  }
  next(error);
};

export function createApp(dependencies: AppDependencies): Express {
  const app = express();
  const sessions = createSessionService(dependencies.resolveLedger, {
    publicMetadataDir: dependencies.publicMetadataDir,
  });

  app.use(express.json({ limit: '16kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, mode: 'testnet' });
  });

  app.post('/api/sessions', (req, res) => {
    try {
      res.status(202).json(sessions.createSession(req.body));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/sessions/:id', (req, res) => {
    try {
      res.json(sessions.getSession(sessionId(req.params.id)));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/sessions/:id/checks', (req, res) => {
    try {
      res.status(202).json(sessions.startChecks(sessionId(req.params.id), req.body));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post(
    '/api/sessions/:id/repair',
    asyncHandler(async (req, res) => {
      try {
        res.status(202).json(await sessions.startRepair(sessionId(req.params.id), req.body));
      } catch (error) {
        sendError(res, error);
      }
    }),
  );

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Unknown API route.' } });
  });

  app.use(jsonErrorHandler);
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) {
      return;
    }
    sendError(res, error);
  });

  return app;
}
