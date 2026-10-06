import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { env } from './core/config';
import { configureHttp } from './http';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureHttp(app);
  app.enableShutdownHooks();
  await app.listen(env().PORT);
  new Logger('Api').log(`API on :${env().PORT} (WhatsApp provider: ${env().WHATSAPP_PROVIDER})`);
}

void bootstrap();
