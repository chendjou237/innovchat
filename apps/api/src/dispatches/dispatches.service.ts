import { Inject, Injectable } from '@nestjs/common';
import {
  DispatchSource,
  RecipientFilter,
  TemplatePurpose,
  describeMetaError,
  formatDayFr,
  maskPhone,
  normalizePhone,
  toDay,
} from '@innovcare/shared';
import { DispatchStatus, MessageTemplate, Prisma } from '@prisma/client';
import type { Redis } from 'ioredis';
import { AuditService } from '../core/audit.service';
import { CryptoService } from '../core/crypto.service';
import { badRequest, conflict, notFound } from '../core/errors';
import { PrismaService, Tx } from '../core/prisma.service';
import { QueueService } from '../core/queues';
import { REDIS } from '../core/redis';
import { RecipientsService, Resolution, isEmptyFilter, parseFilter } from '../recipients/recipients.service';
import { RenderingService, SourceContext, fillBody } from '../recipients/rendering.service';
import { SettingsService } from '../settings/settings.service';
import { assertUsable } from '../templates/templates.service';

export interface DispatchInput {
  template_id: string;
  parameters: Record<string, string>;
  recipients_filter: RecipientFilter;
  title?: string;
  scheduled_for?: string | null;
}

export interface CreateOptions {
  source?: DispatchSource;
  /** AWAITING_CONFIRMATION for attendance draft alerts. */
  status?: Extract<DispatchStatus, 'AWAITING_CONFIRMATION'>;
  /** Source data used for the preview (anomaly, event…), when not yet linked to the dispatch. */
  context?: Partial<SourceContext>;
  tx?: Tx;
  /** Skip the approved-template check (draft alerts are checked again at confirmation). */
  allowUnapproved?: boolean;
}

export interface ListQuery {
  from?: string;
  to?: string;
  purpose?: string;
  status?: string;
  source?: string;
  class_id?: string;
  student_id?: string;
  page?: number;
  page_size?: number;
}

/** Day key used for the daily messaging counter (school time zone). */
export const dailyKey = (d = new Date()) => `wa:daily:${toDay(d)}`;

/**
 * Dispatches: one template, its parameters and a recipient filter (FR-FLT, FR-SCH,
 * FR-CST-002, SRS §8.2–8.3). Recipients are stored as a filter and resolved at send time.
 */
@Injectable()
export class DispatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recipients: RecipientsService,
    private readonly rendering: RenderingService,
    private readonly settings: SettingsService,
    private readonly queues: QueueService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private async template(id: string, tx?: Tx): Promise<MessageTemplate> {
    const t = await (tx ?? this.prisma).messageTemplate.findUnique({ where: { id } });
    if (!t) throw notFound('Modèle introuvable');
    return t;
  }

  async estimateCost(template: Pick<MessageTemplate, 'metaCategory'>, messages: number) {
    const prices = await this.settings.prices();
    return Math.round(messages * prices[template.metaCategory]);
  }

  /** Resolves recipients, counts messages, estimates the cost; sends nothing (FR-FLT-007). */
  async preview(input: Omit<DispatchInput, 'title' | 'scheduled_for'>, opts: { context?: Partial<SourceContext>; tx?: Tx } = {}) {
    const template = await this.template(input.template_id, opts.tx);
    const filter = parseFilter(input.recipients_filter);
    const resolution = await this.recipients.resolve(filter, opts.tx);
    const cost = await this.estimateCost(template, resolution.messageCount);

    const sampleCtx: SourceContext = { ...(await this.rendering.sampleContext()), ...opts.context };
    if (filter.fee_installment_unpaid) {
      sampleCtx.installment = await (opts.tx ?? this.prisma).feeInstallment.findUnique({ where: { id: filter.fee_installment_unpaid } });
    }
    const first = resolution.students[0];
    const params = first
      ? this.rendering.render(template, first, first.contacts[0], sampleCtx, input.parameters)
      : this.rendering.render(template, this.rendering.sampleStudent(), { name: 'Parent' }, sampleCtx, input.parameters);

    const wa = await this.settings.whatsapp();
    const usedToday = Number((await this.redis.get(dailyKey())) ?? 0);
    return {
      students: resolution.students.length,
      messages: resolution.messageCount,
      students_without_contact: resolution.withoutContact.map((s) => ({
        id: s.studentId,
        name: `${s.lastName} ${s.firstName}`,
        class: s.className,
      })),
      estimated_cost_xaf: cost,
      sample_message: fillBody(template.bodyPreview, params),
      template_status: template.metaStatus,
      // Selected panel (§9.1), capped for the browser.
      selected: resolution.students.slice(0, 1000).map((s) => ({
        id: s.studentId,
        name: `${s.lastName} ${s.firstName}`,
        matricule: s.matricule,
        class: s.className,
        phones: s.contacts.map((c) => c.phoneMasked),
        balance: s.balance?.balance,
      })),
      selected_truncated: resolution.students.length > 1000,
      // Large sends are spread over several days by the daily limit (§10.1).
      daily_limit: {
        limit: wa.dailyLimit,
        remaining_today: Math.max(0, wa.dailyLimit - usedToday),
        days_needed: resolution.messageCount <= Math.max(0, wa.dailyLimit - usedToday) ? 1 : 1 + Math.ceil((resolution.messageCount - Math.max(0, wa.dailyLimit - usedToday)) / wa.dailyLimit),
      },
    };
  }

  defaultTitle(template: Pick<MessageTemplate, 'title'>, at: Date) {
    return `${template.title} du ${formatDayFr(toDay(at)).slice(0, 5)}`;
  }

  /** Creates a dispatch. Immediate ones start processing at once; the UI returns quickly (NFR-05). */
  async create(input: DispatchInput, actorId: string | null, opts: CreateOptions = {}) {
    const db = opts.tx ?? this.prisma;
    const template = await this.template(input.template_id, opts.tx);
    if (!opts.allowUnapproved) assertUsable(template);
    const filter = parseFilter(input.recipients_filter);
    if (isEmptyFilter(filter)) throw badRequest('EMPTY_RECIPIENTS', 'Sélectionnez au moins un destinataire.');

    const resolution = await this.recipients.resolve(filter, opts.tx);
    const scheduledFor = input.scheduled_for ? new Date(input.scheduled_for) : null;
    const immediate = !scheduledFor || scheduledFor.getTime() <= Date.now() + 30_000;
    if (!opts.status && immediate && resolution.messageCount === 0) {
      throw badRequest('NO_RECIPIENTS', "Aucun destinataire avec un contact utilisable dans cette sélection.");
    }
    const status: DispatchStatus = opts.status ?? (immediate ? 'PROCESSING' : 'SCHEDULED');

    const dispatch = await db.dispatch.create({
      data: {
        title: input.title?.trim() || this.defaultTitle(template, scheduledFor ?? new Date()),
        templateId: template.id,
        purpose: template.purpose,
        source: opts.source ?? 'MANUAL',
        recipientFilter: filter as Prisma.InputJsonValue,
        fixedParameters: input.parameters,
        status,
        scheduledFor: immediate ? null : scheduledFor,
        startedAt: status === 'PROCESSING' ? new Date() : null,
        estimatedCostXaf: await this.estimateCost(template, resolution.messageCount),
        studentsCount: resolution.students.length,
        messagesCount: resolution.messageCount,
        createdBy: actorId,
      },
    });
    await this.audit.log(actorId, status === 'PROCESSING' ? 'SEND' : status === 'SCHEDULED' ? 'SCHEDULE' : 'DRAFT', 'dispatch', dispatch.id, { title: dispatch.title, messages: resolution.messageCount }, opts.tx);
    if (status === 'PROCESSING' && !opts.tx) await this.queues.processDispatch(dispatch.id);
    return { dispatch, resolution };
  }

  private async lockedCheck(id: string, tx?: Tx) {
    const d = await (tx ?? this.prisma).dispatch.findUnique({ where: { id } });
    if (!d) throw notFound('Envoi introuvable');
    // Editable or cancellable until processing starts (FR-SCH-004).
    if (d.status !== 'SCHEDULED' && d.status !== 'AWAITING_CONFIRMATION') {
      throw conflict('DISPATCH_LOCKED', "Cet envoi est déjà en cours ou terminé : il ne peut plus être modifié.");
    }
    return d;
  }

  async update(id: string, input: { title?: string; parameters?: Record<string, string>; recipients_filter?: RecipientFilter; scheduled_for?: string }, actorId: string | null, tx?: Tx) {
    const db = tx ?? this.prisma;
    const d = await this.lockedCheck(id, tx);
    const template = await this.template(d.templateId, tx);
    const filter = input.recipients_filter ? parseFilter(input.recipients_filter) : parseFilter(d.recipientFilter);
    const resolution = await this.recipients.resolve(filter, tx);
    const data: Prisma.DispatchUpdateInput = {
      title: input.title ?? undefined,
      fixedParameters: input.parameters ?? undefined,
      recipientFilter: filter as Prisma.InputJsonValue,
      studentsCount: resolution.students.length,
      messagesCount: resolution.messageCount,
      estimatedCostXaf: await this.estimateCost(template, resolution.messageCount),
    };
    if (input.scheduled_for) {
      const at = new Date(input.scheduled_for);
      if (at.getTime() < Date.now() - 60_000) throw badRequest('SCHEDULE_IN_PAST', 'La date programmée est déjà passée.');
      data.scheduledFor = at;
    }
    // Only update if still editable (another worker may have started it meanwhile).
    const res = await db.dispatch.updateMany({ where: { id, status: d.status }, data: data as Prisma.DispatchUpdateManyMutationInput });
    if (res.count === 0) throw conflict('DISPATCH_LOCKED', 'Cet envoi vient de démarrer : il ne peut plus être modifié.');
    await this.audit.log(actorId, 'UPDATE', 'dispatch', id, { scheduled_for: input.scheduled_for, title: input.title }, tx);
    return db.dispatch.findUniqueOrThrow({ where: { id } });
  }

  async cancel(id: string, actorId: string | null, reason?: string, tx?: Tx) {
    const db = tx ?? this.prisma;
    const d = await this.lockedCheck(id, tx);
    const res = await db.dispatch.updateMany({ where: { id, status: d.status }, data: { status: 'CANCELLED', cancelReason: reason ?? null } });
    if (res.count === 0) throw conflict('DISPATCH_LOCKED', 'Cet envoi vient de démarrer : il ne peut plus être annulé.');
    await this.audit.log(actorId, 'CANCEL', 'dispatch', id, { reason }, tx);
    return { ok: true };
  }

  /** Moves draft or scheduled dispatches to PROCESSING and queues them. */
  async start(ids: string[]) {
    for (const id of ids) {
      const res = await this.prisma.dispatch.updateMany({
        where: { id, status: { in: ['AWAITING_CONFIRMATION', 'SCHEDULED'] } },
        data: { status: 'PROCESSING', startedAt: new Date() },
      });
      if (res.count) await this.queues.processDispatch(id);
    }
  }

  async list(q: ListQuery) {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, q.page_size ?? 50));
    const where: Prisma.DispatchWhereInput = { status: { not: 'AWAITING_CONFIRMATION' } };
    if (q.status) where.status = q.status as DispatchStatus;
    if (q.purpose) where.purpose = q.purpose as TemplatePurpose;
    if (q.source) where.source = q.source as DispatchSource;
    if (q.from || q.to) {
      where.createdAt = {
        ...(q.from ? { gte: new Date(`${q.from}T00:00:00+01:00`) } : {}),
        ...(q.to ? { lte: new Date(`${q.to}T23:59:59+01:00`) } : {}),
      };
    }
    if (q.student_id) where.messages = { some: { studentId: q.student_id } };
    else if (q.class_id) where.messages = { some: { student: { enrolments: { some: { classId: q.class_id } } } } };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.dispatch.count({ where }),
      this.prisma.dispatch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { template: { select: { title: true, metaCategory: true } } },
      }),
    ]);
    const counts = await this.statusCounts(items.map((d) => d.id));
    return { total, page, pageSize, items: items.map((d) => ({ ...d, counts: counts.get(d.id) ?? {} })) };
  }

  async statusCounts(ids: string[]) {
    const rows = ids.length
      ? await this.prisma.message.groupBy({ by: ['dispatchId', 'status'], where: { dispatchId: { in: ids } }, _count: { _all: true } })
      : [];
    const out = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const m = out.get(r.dispatchId) ?? {};
      m[r.status] = r._count._all;
      out.set(r.dispatchId, m);
    }
    return out;
  }

  /** Upcoming dispatches with their source (FR-SCH-005). */
  async scheduled() {
    return this.prisma.dispatch.findMany({
      where: { status: 'SCHEDULED' },
      orderBy: { scheduledFor: 'asc' },
      include: {
        template: { select: { title: true, metaCategory: true } },
        eventTrigger: { include: { event: { select: { id: true, title: true } } } },
        feeRule: { include: { installment: { select: { id: true, name: true } } } },
      },
    });
  }

  async get(id: string) {
    const d = await this.prisma.dispatch.findUnique({
      where: { id },
      include: {
        template: true,
        anomaly: true,
        eventTrigger: { include: { event: { select: { id: true, title: true } } } },
        feeRule: { include: { installment: { select: { id: true, name: true } } } },
      },
    });
    if (!d) throw notFound('Envoi introuvable');
    const counts = (await this.statusCounts([id])).get(id) ?? {};
    return { ...d, counts };
  }

  async messages(dispatchId: string, status?: string) {
    const rows = await this.prisma.message.findMany({
      where: { dispatchId, ...(status ? { status: status as never } : {}) },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      include: {
        student: { select: { id: true, firstName: true, lastName: true, matricule: true, enrolments: { orderBy: { createdAt: 'desc' }, take: 1, include: { class: { select: { name: true } } } } } },
        contact: { select: { id: true, name: true, relationship: true } },
      },
    });
    return rows.map(({ phoneE164: _p, student, ...m }) => ({
      ...m,
      student: { id: student.id, name: `${student.lastName} ${student.firstName}`, matricule: student.matricule, class: student.enrolments[0]?.class.name ?? '' },
      error_reason: m.status === 'FAILED' || m.status === 'RETRY_PENDING' ? describeMetaError(m.errorCode, m.errorMessage) : null,
    }));
  }

  /** Corrects the number if given and sends a failed message again (FR-DLV-005, UC-06). */
  async resend(messageId: string, phone: string | undefined, actorId: string | null) {
    const m = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!m) throw notFound('Message introuvable');
    if (m.status !== 'FAILED') throw conflict('NOT_FAILED', "Seuls les messages en échec peuvent être renvoyés.");

    const data: Prisma.MessageUpdateInput = {
      status: 'QUEUED',
      wamid: null,
      attemptCount: 0,
      nextAttemptAt: null,
      lockedUntil: null,
      errorCode: null,
      errorMessage: null,
      failedAt: null,
      sentAt: null,
    };
    if (phone) {
      const e164 = normalizePhone(phone);
      if (!e164) throw badRequest('INVALID_PHONE', `Numéro invalide : ${phone}`);
      const enc = this.crypto.encrypt(e164);
      data.phoneE164 = enc;
      data.phoneMasked = maskPhone(e164);
      // The correction also fixes the parent's contact for future messages.
      await this.prisma.parentContact.update({
        where: { id: m.parentContactId },
        data: { phoneE164: enc, phoneHash: this.crypto.phoneHash(e164), phoneMasked: maskPhone(e164) },
      });
    }
    await this.prisma.$transaction([
      this.prisma.message.update({ where: { id: messageId }, data }),
      this.prisma.dispatch.update({ where: { id: m.dispatchId }, data: { status: 'PROCESSING', completedAt: null } }),
    ]);
    await this.audit.log(actorId, 'RESEND', 'message', messageId, { phoneChanged: !!phone });
    await this.queues.sendMessage(messageId, 0, 0, `r${Date.now()}`);
    return { ok: true };
  }

  async resendFailed(dispatchId: string, actorId: string | null) {
    const failed = await this.prisma.message.findMany({ where: { dispatchId, status: 'FAILED' }, select: { id: true } });
    for (const m of failed) await this.resend(m.id, undefined, actorId);
    return { resent: failed.length };
  }
}

export type { Resolution };
