import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { env } from './core/config';
import { AllExceptionsFilter } from './core/errors';

/** HTTP setup shared by main.ts and the integration tests. */
export function configureHttp(app: INestApplication) {
  const a = app as NestExpressApplication;
  a.setGlobalPrefix('api/v1');
  a.use(cookieParser());
  // Large recipient selections (5,000 student ids) exceed the default 100 kB.
  a.useBodyParser('json', { limit: '5mb' });
  a.enableCors({ origin: env().WEB_ORIGIN, credentials: true });
  a.useGlobalFilters(new AllExceptionsFilter());
  a.set('trust proxy', 1);
  a.disable('x-powered-by');
  serveWeb(a);
  return a;
}

/**
 * When WEB_DIST_DIR points at the built dashboard, the API also serves it, so the
 * dashboard and /api share one origin (needed on hosts without a reverse proxy, e.g. Sevalla).
 */
function serveWeb(a: NestExpressApplication) {
  const dir = env().WEB_DIST_DIR;
  if (!dir || !existsSync(join(dir, 'index.html'))) return;
  a.useStaticAssets(dir, { index: false, maxAge: '1h' });
  const index = join(dir, 'index.html');
  // Client-side routes (/eleves, /historique/…) fall back to index.html.
  a.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}
