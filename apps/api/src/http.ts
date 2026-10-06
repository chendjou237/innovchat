import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
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
  return a;
}
