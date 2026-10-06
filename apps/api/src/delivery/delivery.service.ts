import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  MAX_ATTEMPTS,
  MessageStatus,
  RETRY_DELAYS_MS,
  SCHOOL_TZ,
  canTransition,
  classifyMetaError,
  describeMetaError,
  toDay,
} from '@innovcare/shared';
import { Prisma } from '@prisma/client';
import { addDays } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import type { Redis } from 'ioredis';
import { CryptoService } from '../core/crypto.service';
import { PrismaService } from '../core/prisma.service';
import { QueueService } from '../core/queues';
import { REDIS } from '../core/redis';
import { dailyKey } from '../dispatches/dispatches.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RecipientsService } from '../recipients/recipients.service';
import { RenderingService } from '../recipients/rendering.service';
import { SettingsService } from '../settings/settings.service';
import { WHATSAPP_PROVIDER, WhatsAppProvider } from '../whatsapp/provider';

const LOCK_MS = 2 * 60_000;

interface StatusEvent {
  id: string; // wamid
  status: string; // sent | delivered | read | failed
  timestamp?: string;
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
}

/**
 * The sending engine, run by the worker:
 * dispatch → MESSAGE rows → Cloud API → webhook statuses → completion and failure alerts
 * (FR-SCH-002/003, FR-DLV-001..004, NFR-07/08/09).
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger('Delivery');

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly recipients: RecipientsService,
    private readonly rendering: RenderingService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly crypto: CryptoService,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Starts scheduled dispatches whose time has come (polled every 15 s → NFR-09). */
  async startDueDispatches(now = new Date()) {
    const due = await this.prisma.dispatch.findMany({
      where: { status: 'SCHEDULED', scheduledFor: { lte: now } },
      select: { id: true },
    });
    for (const d of due) {
      // The conditional update makes the start exclusive: editing/cancelling is locked from here (FR-SCH-004).
      const res = await this.prisma.dispatch.updateMany({ where: { id: d.id, status: 'SCHEDULED' }, data: { status: 'PROCESSING', startedAt: now } });
      if (res.count) await this.queues.processDispatch(d.id);
    }
    return due.length;
  }

  /**
   * Resolves recipients at send time, renders each message and creates the MESSAGE rows.
   * Re-running it is harmless: the unique (dispatch, student, contact) key skips existing rows.
   */
  async processDispatch(dispatchId: string) {
    const dispatch = await this.prisma.dispatch.findUnique({ where: { id: dispatchId }, include: { template: true } });
    if (!dispatch || dispatch.status !== 'PROCESSING') return;

    if (!dispatch.materializedAt) {
      if (dispatch.template.metaStatus !== 'APPROVED') {
        await this.prisma.dispatch.update({
          where: { id: dispatchId },
          data: { status: 'CANCELLED', cancelReason: `Modèle non approuvé (${dispatch.template.metaStatus})` },
        });
        await this.notifications.raise(
          'TEMPLATE_REJECTED',
          `Envoi « ${dispatch.title} » annulé : le modèle « ${dispatch.template.title} » n'est pas approuvé (${dispatch.template.metaStatus}).`,
          `/historique/${dispatchId}`,
          `blocked-${dispatchId}`,
        );
        return;
      }

      const resolution = await this.recipients.resolve(dispatch.recipientFilter);
      const ctx = await this.rendering.sourceContext(dispatch);
      const shared = (dispatch.fixedParameters ?? {}) as Record<string, string>;
      const rows: Prisma.MessageCreateManyInput[] = [];
      for (const s of resolution.students) {
        for (const c of s.contacts) {
          rows.push({
            dispatchId,
            studentId: s.studentId,
            parentContactId: c.id,
            phoneE164: c.phoneE164,
            phoneMasked: c.phoneMasked,
            renderedParameters: this.rendering.render(dispatch.template, s, c, ctx, shared),
          });
        }
      }
      for (let i = 0; i < rows.length; i += 1000) {
        await this.prisma.message.createMany({ data: rows.slice(i, i + 1000), skipDuplicates: true });
      }
      const prices = await this.settings.prices();
      await this.prisma.dispatch.update({
        where: { id: dispatchId },
        data: {
          materializedAt: new Date(),
          studentsCount: resolution.students.length,
          messagesCount: rows.length,
          estimatedCostXaf: Math.round(rows.length * prices[dispatch.template.metaCategory]),
        },
      });
    }

    const pending = await this.prisma.message.findMany({
      where: { dispatchId, status: 'QUEUED', wamid: null },
      select: { id: true, attemptCount: true },
    });
    for (let i = 0; i < pending.length; i += 500) {
      await this.queues.sendMessages(pending.slice(i, i + 500).map((m) => ({ messageId: m.id, attempt: m.attemptCount })));
    }
    if (pending.length === 0) await this.finalize(dispatchId);
  }

  /** Next morning 07:00 school time, when the daily limit is reached. */
  private nextDayStart(now = new Date()) {
    const tomorrow = toDay(addDays(now, 1));
    return fromZonedTime(`${tomorrow}T07:00:00`, SCHOOL_TZ);
  }

  /** Sends one message. Returns what happened (for tests and logs). */
  async sendMessage(messageId: string): Promise<'sent' | 'skipped' | 'retry' | 'failed' | 'deferred'> {
    const now = new Date();
    // Claim the message: only one worker may send it, and never twice (NFR-08).
    const claimed = await this.prisma.message.updateMany({
      where: {
        id: messageId,
        status: { in: ['QUEUED', 'RETRY_PENDING'] },
        wamid: null,
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      },
      data: { lockedUntil: new Date(now.getTime() + LOCK_MS), attemptCount: { increment: 1 } },
    });
    if (claimed.count === 0) return 'skipped';

    const m = await this.prisma.message.findUniqueOrThrow({ where: { id: messageId }, include: { dispatch: { include: { template: true } } } });

    // Daily messaging limit of the number's tier: spread oversized dispatches over several days (§6.1, §10.1).
    const { dailyLimit } = await this.settings.whatsapp();
    const key = dailyKey(now);
    const used = await this.redis.incr(key);
    if (used === 1) await this.redis.expire(key, 2 * 86400);
    if (used > dailyLimit) {
      await this.redis.decr(key);
      const at = this.nextDayStart(now);
      await this.prisma.message.update({ where: { id: messageId }, data: { lockedUntil: null, attemptCount: { decrement: 1 }, nextAttemptAt: at } });
      await this.queues.sendMessage(messageId, m.attemptCount - 1, at.getTime() - now.getTime(), `d${toDay(at)}`);
      return 'deferred';
    }

    const phone = this.crypto.decrypt(m.phoneE164);
    const result = await this.provider.sendTemplate(phone, m.dispatch.template.metaName, m.dispatch.template.language, m.renderedParameters as string[]);

    if (result.ok) {
      // The status becomes SENT on webhook confirmation (§6.1).
      await this.prisma.message.update({
        where: { id: messageId },
        data: { wamid: result.wamid, lockedUntil: null, nextAttemptAt: null, errorCode: null, errorMessage: null },
      });
      return 'sent';
    }

    await this.redis.decr(key); // a rejected send does not count against the limit
    return this.handleError(messageId, m.attemptCount, m.status as MessageStatus, result.code, result.message, m.dispatchId);
  }

  /** Temporary errors are retried after 1, 5 and 30 minutes; permanent ones fail at once (FR-DLV-002/003). */
  private async handleError(messageId: string, attempts: number, current: MessageStatus, code: string, message: string, dispatchId: string) {
    const kind = classifyMetaError(code);
    if (kind === 'TEMPORARY' && attempts < MAX_ATTEMPTS) {
      const delay = RETRY_DELAYS_MS[attempts - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      await this.prisma.message.update({
        where: { id: messageId },
        data: { status: 'RETRY_PENDING', wamid: null, lockedUntil: null, errorCode: code, errorMessage: message, nextAttemptAt: new Date(Date.now() + delay) },
      });
      await this.queues.sendMessage(messageId, attempts, delay);
      this.logger.warn(`message ${messageId}: ${code} (${kind}), retry ${attempts}/${MAX_ATTEMPTS - 1} in ${delay / 1000}s`);
      return 'retry' as const;
    }
    if (!canTransition(current, 'FAILED') && current !== 'RETRY_PENDING') return 'skipped' as const;
    await this.prisma.message.update({
      where: { id: messageId },
      data: { status: 'FAILED', lockedUntil: null, failedAt: new Date(), errorCode: code, errorMessage: message, nextAttemptAt: null },
    });
    this.logger.warn(`message ${messageId}: failed (${code} ${describeMetaError(code, message)})`);
    await this.queues.finalizeDispatch(dispatchId);
    return 'failed' as const;
  }

  /** Applies a stored webhook event (§6.3). Statuses only move forward; repeats are ignored. */
  async processWebhook(eventId: string) {
    const ev = await this.prisma.webhookEvent.findUnique({ where: { id: eventId } });
    if (!ev || ev.processedAt) return;
    const body = ev.body as { entry?: { changes?: { value?: { statuses?: StatusEvent[] } }[] }[] };
    const statuses = (body.entry ?? []).flatMap((e) => (e.changes ?? []).flatMap((c) => c.value?.statuses ?? []));
    const unknown: string[] = [];
    for (const s of statuses) {
      const applied = await this.applyStatus(s);
      if (applied === 'unknown') unknown.push(s.id);
    }
    // A status may arrive before the send job has stored the wamid: let the queue retry for a minute.
    if (unknown.length && Date.now() - ev.createdAt.getTime() < 60_000) {
      throw new Error(`wamid inconnu pour l'instant : ${unknown.join(', ')}`);
    }
    await this.prisma.webhookEvent.update({ where: { id: eventId }, data: { processedAt: new Date(), error: unknown.length ? `wamid inconnus : ${unknown.join(', ')}` : null } });
  }

  async applyStatus(s: StatusEvent): Promise<'applied' | 'ignored' | 'unknown'> {
    const m = await this.prisma.message.findFirst({ where: { wamid: s.id } });
    if (!m) return 'unknown';
    const at = s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date();
    const current = m.status as MessageStatus;

    if (s.status === 'failed') {
      const err = s.errors?.[0];
      const code = String(err?.code ?? '');
      const msg = err?.error_data?.details ?? err?.message ?? err?.title ?? '';
      if (classifyMetaError(code) === 'TEMPORARY' && m.attemptCount < MAX_ATTEMPTS && canTransition(current, 'RETRY_PENDING')) {
        await this.handleError(m.id, m.attemptCount, current, code, msg, m.dispatchId);
        return 'applied';
      }
      if (!canTransition(current, 'FAILED')) return 'ignored';
      const res = await this.prisma.message.updateMany({
        where: { id: m.id, status: current },
        data: { status: 'FAILED', failedAt: at, errorCode: code, errorMessage: msg },
      });
      if (res.count) await this.queues.finalizeDispatch(m.dispatchId);
      return res.count ? 'applied' : 'ignored';
    }

    const next = ({ sent: 'SENT', delivered: 'DELIVERED', read: 'READ' } as const)[s.status as 'sent' | 'delivered' | 'read'];
    if (!next || !canTransition(current, next)) return 'ignored';
    const data: Prisma.MessageUpdateManyMutationInput = { status: next };
    if (!m.sentAt) data.sentAt = at;
    if (next !== 'SENT' && !m.deliveredAt) data.deliveredAt = at;
    if (next === 'READ') data.readAt = at;
    // Conditional on the status we read, so concurrent events can't move it backwards.
    const res = await this.prisma.message.updateMany({ where: { id: m.id, status: current }, data });
    if (res.count && current === 'QUEUED') await this.queues.finalizeDispatch(m.dispatchId);
    return res.count ? 'applied' : 'ignored';
  }

  /**
   * Completes a dispatch when no message is waiting to be sent, and raises one grouped
   * notification for its failures (FR-DLV-004).
   */
  async finalize(dispatchId: string) {
    const d = await this.prisma.dispatch.findUnique({ where: { id: dispatchId } });
    if (!d || !['PROCESSING', 'COMPLETED', 'COMPLETED_WITH_FAILURES'].includes(d.status)) return;
    if (d.status === 'PROCESSING' && !d.materializedAt) return;

    const pending = await this.prisma.message.count({
      where: { dispatchId, OR: [{ status: 'RETRY_PENDING' }, { status: 'QUEUED', wamid: null }] },
    });
    if (pending > 0) return;

    const failed = await this.prisma.message.count({ where: { dispatchId, status: 'FAILED' } });
    const status = failed > 0 ? 'COMPLETED_WITH_FAILURES' : 'COMPLETED';
    if (d.status !== status) {
      await this.prisma.dispatch.update({ where: { id: dispatchId }, data: { status, completedAt: d.completedAt ?? new Date() } });
    }
    if (failed > 0) {
      const what = failed === 1 ? '1 message en échec' : `${failed} messages en échec`;
      await this.notifications.raise('DISPATCH_FAILURES', `${what} — ${d.title}`, `/historique/${dispatchId}`, `failures-${dispatchId}`);
    } else {
      await this.notifications.clear(`failures-${dispatchId}`);
    }
  }

  /**
   * Recovery after a crash or restart (NFR-07): re-queues work whose job may have been lost.
   * Deterministic job ids make this a no-op for work that is still queued.
   */
  async recover(now = new Date()) {
    const stale = new Date(now.getTime() - LOCK_MS);
    const dispatches = await this.prisma.dispatch.findMany({
      where: { status: 'PROCESSING', materializedAt: null, startedAt: { lt: stale } },
      select: { id: true },
    });
    for (const d of dispatches) await this.queues.processDispatch(d.id);

    const messages = await this.prisma.message.findMany({
      where: {
        wamid: null,
        OR: [
          // Deferred by the daily limit: nextAttemptAt is in the future, leave it alone.
          { status: 'QUEUED', updatedAt: { lt: stale }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lt: now } }] },
          { status: 'RETRY_PENDING', nextAttemptAt: { lt: new Date(now.getTime() - 60_000) } },
        ],
        AND: [{ OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }],
        dispatch: { status: 'PROCESSING' },
      },
      select: { id: true, attemptCount: true },
      take: 5000,
    });
    if (messages.length) await this.queues.sendMessages(messages.map((m) => ({ messageId: m.id, attempt: m.attemptCount })));

    const open = await this.prisma.dispatch.findMany({ where: { status: 'PROCESSING', materializedAt: { not: null } }, select: { id: true } });
    for (const d of open) await this.queues.finalizeDispatch(d.id);
    return { dispatches: dispatches.length, messages: messages.length };
  }
}
