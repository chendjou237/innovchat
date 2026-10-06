import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DomainModule } from './domain.module';
import { WorkerService } from './worker/worker.service';

@Module({ imports: [DomainModule], providers: [WorkerService] })
export class WorkerModule {}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
}

void bootstrap();
