import { Injectable } from '@nestjs/common';
import {
  formatDayFr,
  formatDayLongFr,
  formatTimeFr,
  formatXaf,
  toDay,
} from '@innovcare/shared';
import type { AttendanceAnomaly, CalendarEvent, Dispatch, FeeInstallment, MessageTemplate, Subject } from '@prisma/client';
import { PrismaService, Tx } from '../core/prisma.service';
import { SettingsService } from '../settings/settings.service';
import type { ResolvedContact, ResolvedStudent } from './recipients.service';
import { parseFilter } from './recipients.service';

/** Data read at send time for the dispatch's source (FR-SCH-003). */
export interface SourceContext {
  anomaly?: (AttendanceAnomaly & { subject: Subject | null }) | null;
  event?: CalendarEvent | null;
  installment?: FeeInstallment | null;
  school: { name: string; phone: string };
}

const EMPTY = '—';

/** Meta rejects parameters with newlines, tabs or more than 4 consecutive spaces. */
export function cleanParam(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  const cleaned = s.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  return cleaned || EMPTY;
}

/** Replaces {{1}}, {{2}}… in a template body. */
export function fillBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? `{{${n}}}`);
}

function eventDate(e: CalendarEvent): string {
  const start = toDay(e.startDate);
  const end = toDay(e.endDate);
  return start === end ? formatDayLongFr(start) : `du ${formatDayLongFr(start)} au ${formatDayLongFr(end)}`;
}

/**
 * Builds per-message template parameters from the template's parameter_map,
 * the student, the contact, the source context and the dispatch's shared parameters
 * (FR-TPL-003, FR-FEE-006).
 */
@Injectable()
export class RenderingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async sourceContext(
    dispatch: Pick<Dispatch, 'id' | 'recipientFilter'>,
    tx?: Tx,
  ): Promise<SourceContext> {
    const db = tx ?? this.prisma;
    const [anomaly, trigger, school] = await Promise.all([
      db.attendanceAnomaly.findUnique({ where: { messageDispatchId: dispatch.id }, include: { subject: true } }),
      db.eventTrigger.findUnique({ where: { dispatchId: dispatch.id }, include: { event: true } }),
      this.settings.school(),
    ]);
    const filter = parseFilter(dispatch.recipientFilter);
    const installment = filter.fee_installment_unpaid
      ? await db.feeInstallment.findUnique({ where: { id: filter.fee_installment_unpaid } })
      : null;
    return { anomaly, event: trigger?.event ?? null, installment, school };
  }

  fieldValues(
    student: Pick<ResolvedStudent, 'firstName' | 'lastName' | 'className' | 'balance'>,
    contact: Pick<ResolvedContact, 'name'> | null,
    ctx: SourceContext,
  ): Record<string, string | number | null | undefined> {
    const a = ctx.anomaly;
    const e = ctx.event;
    const i = ctx.installment;
    return {
      parent_name: contact?.name,
      student_full_name: `${student.firstName} ${student.lastName}`,
      student_first_name: student.firstName,
      class_name: student.className,
      date: a ? formatDayFr(toDay(a.date)) : undefined,
      subject: a?.subject?.name,
      time_slot: a?.timeSlot,
      arrival_time: a?.arrivalTime ? formatTimeFr(a.arrivalTime) : undefined,
      installment_name: i?.name,
      balance_due: student.balance ? formatXaf(student.balance.balance) : undefined,
      due_date: i ? formatDayFr(toDay(i.dueDate)) : undefined,
      event_title: e?.title,
      event_date: e ? eventDate(e) : undefined,
      event_time: e?.startTime ? formatTimeFr(e.startTime) : undefined,
      event_place: e?.place,
      event_description: e?.description,
      school_name: ctx.school.name,
      school_phone: ctx.school.phone,
    };
  }

  render(
    template: Pick<MessageTemplate, 'parameterMap'>,
    student: Pick<ResolvedStudent, 'firstName' | 'lastName' | 'className' | 'balance'>,
    contact: Pick<ResolvedContact, 'name'> | null,
    ctx: SourceContext,
    shared: Record<string, string>,
  ): string[] {
    const map = (template.parameterMap ?? []) as string[];
    const values = this.fieldValues(student, contact, ctx);
    return map.map((key) => {
      if (key.startsWith('param:')) return cleanParam(shared[key.slice(6)]);
      const v = values[key];
      // Fields with no value from the system can be supplied as shared parameters (§8.2).
      return cleanParam(v === undefined || v === null || v === '' ? shared[key] : v);
    });
  }

  /** Sample source data for template previews (FR-TPL-005). */
  async sampleContext(): Promise<SourceContext> {
    const today = new Date();
    return {
      anomaly: {
        date: today,
        subject: { name: 'Mathématiques' },
        timeSlot: '08:00-10:00',
        arrivalTime: '07:45',
      } as SourceContext['anomaly'],
      event: {
        title: 'Réunion des parents',
        startDate: today,
        endDate: today,
        startTime: '10:00',
        place: 'Salle polyvalente',
        description: 'Présentation des résultats du trimestre',
      } as SourceContext['event'],
      installment: { name: '1ère tranche', dueDate: today } as SourceContext['installment'],
      school: await this.settings.school(),
    };
  }

  /** Sample data for previews when no real recipient is available (FR-TPL-005). */
  sampleStudent(): Pick<ResolvedStudent, 'firstName' | 'lastName' | 'className' | 'balance'> {
    return {
      firstName: 'Awa',
      lastName: 'Ngono',
      className: '4e B',
      balance: { studentFeeId: '', enrolmentId: '', due: 75000, paid: 25000, balance: 50000 },
    };
  }
}
