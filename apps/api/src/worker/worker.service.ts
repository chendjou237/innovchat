import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { createRedis } from '../core/redis';
import { QUEUE, QueueService } from '../core/queues';
import { DeliveryService } from '../delivery/delivery.service';
import { SettingsService } from '../settings/settings.service';
import { TemplatesService } from '../templates/templates.service';

/** Queue consumers and periodic jobs (scheduler tick, recovery sweep, template sync). */
@Injectable()
export class WorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Worker');
  private workers: Worker[] = [];

  constructor(
    private readonly delivery: DeliveryService,
    private readonly templates: TemplatesService,
    private readonly settings: SettingsService,
    private readonly queues: QueueService,
  ) {}

  async onModuleInit() {
    const { messagesPerSecond } = await this.settings.whatsapp();
    const make = (name: string, handler: (job: Job) => Promise<unknown>, opts: Partial<ConstructorParameters<typeof Worker>[2]> = {}) => {
      const w = new Worker(name, handler, { connection: createRedis(), concurrency: 5, ...opts });
      w.on('failed', (job, err) => this.logger.error(`${name}/${job?.name} ${job?.id} failed: ${err.message}`));
      this.workers.push(w);
    };

    make(QUEUE.dispatch, async (job) => {
      if (job.name === 'process') return this.delivery.processDispatch(job.data.dispatchId);
      if (job.name === 'finalize') return this.delivery.finalize(job.data.dispatchId);
    });
    // Sending rate follows the tier Meta assigns to the number (§6.1).
    make(QUEUE.message, (job) => this.delivery.sendMessage(job.data.messageId), { concurrency: 10, limiter: { max: messagesPerSecond, duration: 1000 } });
    make(QUEUE.webhook, (job) => this.delivery.processWebhook(job.data.eventId), { concurrency: 10 });
    make(
      QUEUE.maintenance,
      async (job) => {
        if (job.name === 'scheduler-tick') return this.delivery.startDueDispatches();
        if (job.name === 'recovery') return this.delivery.recover();
        if (job.name === 'template-sync') return this.templates.sync();
      },
      { concurrency: 1 },
    );

    // Scheduled dispatches start within one minute of their time (NFR-09).
    await this.queues.maintenance.upsertJobScheduler('scheduler-tick', { every: 15_000 }, { name: 'scheduler-tick' });
    await this.queues.maintenance.upsertJobScheduler('recovery', { every: 60_000 }, { name: 'recovery' });
    await this.queues.maintenance.upsertJobScheduler('template-sync', { every: 6 * 3600_000 }, { name: 'template-sync' });
    await this.queues.syncTemplates();
    await this.delivery.recover();
    this.logger.log(`worker started (${messagesPerSecond} msg/s)`);
  }

  async onApplicationShutdown() {
    await Promise.all(this.workers.map((w) => w.close()));
  }
}
