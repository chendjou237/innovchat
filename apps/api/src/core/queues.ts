import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { JobsOptions, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { REDIS } from './redis';

export const QUEUE = {
  dispatch: 'dispatch',
  message: 'message',
  webhook: 'webhook',
  maintenance: 'maintenance',
} as const;

// Finished jobs are removed so that their deterministic ids can be reused later
// (a recovery sweep re-enqueues work that a crash may have lost).
const defaults: JobsOptions = { removeOnComplete: true, removeOnFail: true, attempts: 5, backoff: { type: 'exponential', delay: 2000 } };

/**
 * Producer side of the job queues (BullMQ on Redis with AOF, so jobs survive a restart — NFR-07).
 * Job ids are deterministic so that enqueueing the same work twice is a no-op.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  readonly dispatch: Queue;
  readonly message: Queue;
  readonly webhook: Queue;
  readonly maintenance: Queue;

  constructor(@Inject(REDIS) connection: Redis) {
    this.dispatch = new Queue(QUEUE.dispatch, { connection, defaultJobOptions: defaults });
    this.message = new Queue(QUEUE.message, { connection, defaultJobOptions: { ...defaults, attempts: 3 } });
    this.webhook = new Queue(QUEUE.webhook, { connection, defaultJobOptions: defaults });
    this.maintenance = new Queue(QUEUE.maintenance, { connection, defaultJobOptions: { removeOnComplete: 100, removeOnFail: 500 } });
  }

  processDispatch(dispatchId: string) {
    return this.dispatch.add('process', { dispatchId }, { jobId: `process-${dispatchId}` });
  }

  /** Debounced: several message updates within 2 s produce one finalize check. */
  finalizeDispatch(dispatchId: string) {
    return this.dispatch.add('finalize', { dispatchId }, { jobId: `finalize-${dispatchId}`, delay: 2000 });
  }

  sendMessage(messageId: string, attempt: number, delayMs = 0, suffix = '') {
    return this.message.add('send', { messageId }, { jobId: `send-${messageId}-${attempt}${suffix}`, delay: Math.max(0, delayMs) });
  }

  sendMessages(items: { messageId: string; attempt: number }[]) {
    return this.message.addBulk(
      items.map((i) => ({ name: 'send', data: { messageId: i.messageId }, opts: { jobId: `send-${i.messageId}-${i.attempt}` } })),
    );
  }

  processWebhook(eventId: string) {
    return this.webhook.add('process', { eventId }, { jobId: `wh-${eventId}` });
  }

  syncTemplates() {
    return this.maintenance.add('template-sync', {}, { jobId: `template-sync-${Date.now()}` });
  }

  async onModuleDestroy() {
    await Promise.all([this.dispatch.close(), this.message.close(), this.webhook.close(), this.maintenance.close()]);
  }
}
