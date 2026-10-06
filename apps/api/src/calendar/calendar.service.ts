import { Injectable } from '@nestjs/common';
import { EventType, RecipientFilter, formatDayFr, normalizeTime, parseDay, toDay, triggerInstant } from '@innovcare/shared';
import { Prisma } from '@prisma/client';
import { AuditService } from '../core/audit.service';
import { notFound } from '../core/errors';
import { PrismaService, Tx } from '../core/prisma.service';
import { DispatchesService } from '../dispatches/dispatches.service';
import { TemplatesService } from '../templates/templates.service';

export interface EventInput {
  title: string;
  type: EventType;
  start_date: string;
  end_date: string;
  start_time: string | null;
  place: string | null;
  description: string | null;
  recipient_filter: RecipientFilter;
  template_id: string | null;
  triggers: { days_offset: number; send_time: string }[];
}

const MIN_LEAD_MS = 60_000;

export function triggerLabel(daysOffset: number, sendTime: string) {
  if (daysOffset === 0) return `jour J à ${sendTime}`;
  return daysOffset < 0 ? `J-${-daysOffset} à ${sendTime}` : `J+${daysOffset} à ${sendTime}`;
}

/**
 * Calendar events with automatic trigger rules (FR-CAL-001..006, UC-04).
 * Each trigger owns one scheduled dispatch; editing the event moves it, deleting cancels it.
 * Event details are read at send time, so the message always carries the latest values.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatches: DispatchesService,
    private readonly templates: TemplatesService,
    private readonly audit: AuditService,
  ) {}

  async list(from?: string, to?: string) {
    const where: Prisma.CalendarEventWhereInput = {};
    if (from || to) {
      // Events overlapping [from, to].
      where.AND = [
        ...(to ? [{ startDate: { lte: parseDay(to) } }] : []),
        ...(from ? [{ endDate: { gte: parseDay(from) } }] : []),
      ];
    }
    const events = await this.prisma.calendarEvent.findMany({
      where,
      orderBy: [{ startDate: 'asc' }, { startTime: 'asc' }],
      include: {
        triggers: {
          orderBy: { daysOffset: 'asc' },
          include: { dispatch: { select: { id: true, status: true, scheduledFor: true, messagesCount: true, estimatedCostXaf: true } } },
        },
      },
    });
    return events.map((e) => this.view(e));
  }

  async get(id: string) {
    const e = await this.prisma.calendarEvent.findUnique({
      where: { id },
      include: { triggers: { orderBy: { daysOffset: 'asc' }, include: { dispatch: { select: { id: true, status: true, scheduledFor: true, messagesCount: true, estimatedCostXaf: true } } } } },
    });
    if (!e) throw notFound('Événement introuvable');
    return this.view(e);
  }

  private view<T extends { startDate: Date; endDate: Date }>(e: T) {
    return { ...e, start_date: toDay(e.startDate), end_date: toDay(e.endDate) };
  }

  async save(input: EventInput, actorId: string, id?: string) {
    const template = input.template_id ? await this.templates.get(input.template_id) : await this.templates.forPurpose('CALENDAR');
    const warnings: string[] = [];

    const eventId = await this.prisma.$transaction(
      async (tx) => {
        const data = {
          title: input.title,
          type: input.type,
          startDate: parseDay(input.start_date),
          endDate: parseDay(input.end_date),
          startTime: input.start_time,
          place: input.place,
          description: input.description,
          recipientFilter: input.recipient_filter as Prisma.InputJsonValue,
          templateId: template.id,
        };
        const event = id ? await tx.calendarEvent.update({ where: { id }, data }) : await tx.calendarEvent.create({ data });

        const existing = await tx.eventTrigger.findMany({ where: { eventId: event.id }, include: { dispatch: true } });
        const key = (o: number, t: string) => `${o}@${normalizeTime(t)}`;
        // Identical triggers would send the same message twice: keep one of each.
        const wanted = new Map(input.triggers.map((t) => [key(t.days_offset, t.send_time), { ...t, send_time: normalizeTime(t.send_time) }]));
        const triggers = [...wanted.values()];

        // Triggers removed from the form: cancel their pending dispatch.
        for (const t of existing.filter((t) => !wanted.has(key(t.daysOffset, t.sendTime)))) {
          if (t.dispatch?.status === 'SCHEDULED') await this.dispatches.cancel(t.dispatch.id, actorId, 'Déclencheur supprimé', tx);
          await tx.eventTrigger.delete({ where: { id: t.id } });
        }

        for (const t of triggers) {
          const at = triggerInstant(input.start_date, t.days_offset, t.send_time);
          const label = triggerLabel(t.days_offset, t.send_time);
          const title = `${input.title} — ${formatDayFr(input.start_date)} (${label})`;
          let trigger = existing.find((e) => key(e.daysOffset, e.sendTime) === key(t.days_offset, t.send_time));
          if (!trigger) trigger = { ...(await tx.eventTrigger.create({ data: { eventId: event.id, daysOffset: t.days_offset, sendTime: t.send_time } })), dispatch: null };

          const d = trigger.dispatch;
          if (d && d.status !== 'SCHEDULED' && d.status !== 'CANCELLED') continue; // already sent: not affected (FR-CAL-005)
          const future = at.getTime() > Date.now() + MIN_LEAD_MS;

          if (d?.status === 'SCHEDULED') {
            if (!future) {
              await this.dispatches.cancel(d.id, actorId, 'Date de déclenchement passée', tx);
              warnings.push(`Déclencheur ${label} : date passée, envoi annulé.`);
              continue;
            }
            if (d.templateId !== template.id) await tx.dispatch.update({ where: { id: d.id }, data: { templateId: template.id, purpose: template.purpose } });
            await this.dispatches.update(d.id, { title, recipients_filter: input.recipient_filter, scheduled_for: at.toISOString() }, actorId, tx);
            continue;
          }
          if (!future) {
            warnings.push(`Déclencheur ${label} : date déjà passée, aucun envoi programmé.`);
            continue;
          }
          const { dispatch } = await this.dispatches.create(
            { template_id: template.id, parameters: {}, recipients_filter: input.recipient_filter, title, scheduled_for: at.toISOString() },
            actorId,
            { source: 'CALENDAR', tx, allowUnapproved: true },
          );
          await tx.eventTrigger.update({ where: { id: trigger.id }, data: { dispatchId: dispatch.id } });
        }
        await this.audit.log(actorId, id ? 'UPDATE' : 'CREATE', 'calendar_event', event.id, { title: input.title, start: input.start_date }, tx);
        return event.id;
      },
      { timeout: 60_000 },
    );
    return { ...(await this.get(eventId)), warnings };
  }

  /** Deleting an event cancels its pending dispatches; sent messages are not affected (FR-CAL-005). */
  async remove(id: string, actorId: string) {
    await this.prisma.$transaction(async (tx: Tx) => {
      const triggers = await tx.eventTrigger.findMany({ where: { eventId: id }, include: { dispatch: true } });
      for (const t of triggers) {
        if (t.dispatch?.status === 'SCHEDULED') await this.dispatches.cancel(t.dispatch.id, actorId, 'Événement supprimé', tx);
      }
      await tx.calendarEvent.delete({ where: { id } });
      await this.audit.log(actorId, 'DELETE', 'calendar_event', id, {}, tx);
    });
    return { ok: true };
  }
}
