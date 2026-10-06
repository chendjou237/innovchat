import { Injectable } from '@nestjs/common';
import { AnomalyType, TemplatePurpose, formatDayFr, parseDay, toDay } from '@innovcare/shared';
import { Prisma } from '@prisma/client';
import { AuditService } from '../core/audit.service';
import { badRequest, conflict, notFound } from '../core/errors';
import { PrismaService } from '../core/prisma.service';
import { DispatchesService } from '../dispatches/dispatches.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrgService } from '../org/org.service';
import { RecipientsService } from '../recipients/recipients.service';
import { RenderingService, fillBody } from '../recipients/rendering.service';
import { TemplatesService } from '../templates/templates.service';

export interface RecordInput {
  type: AnomalyType;
  date: string;
  subject_id: string | null;
  time_slot: string | null;
  arrival_time: string | null;
  student_ids: string[];
  note: string | null;
}

export interface HistoryQuery {
  class_id?: string;
  student_id?: string;
  type?: string;
  from?: string;
  to?: string;
  justified?: string;
}

const EDITABLE = ['AWAITING_CONFIRMATION', 'CANCELLED'];

/**
 * Attendance anomalies and their draft alerts (FR-ATT-001..008, UC-01).
 * Each anomaly gets a DISPATCH in status AWAITING_CONFIRMATION; nothing is sent until confirmed.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly org: OrgService,
    private readonly templates: TemplatesService,
    private readonly dispatches: DispatchesService,
    private readonly notifications: NotificationsService,
    private readonly recipients: RecipientsService,
    private readonly rendering: RenderingService,
    private readonly audit: AuditService,
  ) {}

  async record(input: RecordInput, actorId: string) {
    const year = await this.org.activeYear();
    const enrolments = await this.prisma.enrolment.findMany({
      where: { academicYearId: year.id, studentId: { in: input.student_ids }, student: { status: 'ACTIVE' } },
      include: { student: true, class: true },
    });
    if (enrolments.length !== new Set(input.student_ids).size) {
      throw badRequest('STUDENT_NOT_ENROLLED', "Un ou plusieurs élèves ne sont pas inscrits dans l'année active.");
    }
    const purpose: TemplatePurpose = input.type === 'ABSENCE' ? 'ABSENCE' : 'TARDINESS';
    const template = await this.templates.forPurpose(purpose);

    const created = await this.prisma.$transaction(
      async (tx) => {
        const out = [];
        for (const e of enrolments) {
          const { dispatch } = await this.dispatches.create(
            {
              template_id: template.id,
              parameters: {},
              recipients_filter: { whole_school: false, department_ids: [], class_ids: [], student_ids: [e.studentId], exclude_student_ids: [], fee_installment_unpaid: null },
              title: `${input.type === 'ABSENCE' ? 'Absence' : 'Retard'} — ${e.student.lastName} ${e.student.firstName} (${e.class.name}) — ${formatDayFr(input.date)}`,
            },
            actorId,
            { source: 'ATTENDANCE', status: 'AWAITING_CONFIRMATION', tx, allowUnapproved: true },
          );
          const anomaly = await tx.attendanceAnomaly.create({
            data: {
              enrolmentId: e.id,
              type: input.type,
              date: parseDay(input.date),
              subjectId: input.subject_id,
              timeSlot: input.time_slot,
              arrivalTime: input.arrival_time,
              note: input.note,
              recordedBy: actorId,
              messageDispatchId: dispatch.id,
            },
          });
          await this.audit.log(actorId, 'CREATE', 'attendance_anomaly', anomaly.id, { type: input.type, studentId: e.studentId }, tx);
          out.push({ ...anomaly, alert_id: dispatch.id, alert_status: dispatch.status });
        }
        return out;
      },
      { timeout: 60_000 },
    );
    await this.notifications.refreshAwaitingConfirmation();
    return created;
  }

  private async editableAnomaly(id: string) {
    const a = await this.prisma.attendanceAnomaly.findUnique({ where: { id }, include: { dispatch: true } });
    if (!a) throw notFound('Anomalie introuvable');
    if (a.dispatch && !EDITABLE.includes(a.dispatch.status)) {
      throw conflict('ALERT_ALREADY_SENT', "L'alerte a déjà été envoyée : l'anomalie peut seulement être justifiée.");
    }
    return a;
  }

  async update(id: string, input: { date?: string; subject_id?: string | null; time_slot?: string | null; arrival_time?: string | null; note?: string | null }, actorId: string) {
    await this.editableAnomaly(id);
    const a = await this.prisma.attendanceAnomaly.update({
      where: { id },
      data: {
        date: input.date ? parseDay(input.date) : undefined,
        subjectId: input.subject_id,
        timeSlot: input.time_slot,
        arrivalTime: input.arrival_time,
        note: input.note,
      },
    });
    await this.audit.log(actorId, 'UPDATE', 'attendance_anomaly', id, input);
    return a;
  }

  async remove(id: string, actorId: string) {
    const a = await this.editableAnomaly(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.attendanceAnomaly.delete({ where: { id } });
      if (a.messageDispatchId) {
        await tx.message.deleteMany({ where: { dispatchId: a.messageDispatchId, status: 'QUEUED', wamid: null } });
        await tx.dispatch.delete({ where: { id: a.messageDispatchId } });
      }
      await this.audit.log(actorId, 'DELETE', 'attendance_anomaly', id, {}, tx);
    });
    await this.notifications.refreshAwaitingConfirmation();
    return { ok: true };
  }

  async justify(id: string, note: string, actorId: string) {
    const a = await this.prisma.attendanceAnomaly.update({ where: { id }, data: { isJustified: true, justificationNote: note } });
    await this.audit.log(actorId, 'JUSTIFY', 'attendance_anomaly', id, { note });
    return a;
  }

  /** Draft alerts with the exact French text the parent will receive (FR-ATT-005, §9.2). */
  async pending() {
    const drafts = await this.prisma.dispatch.findMany({
      where: { status: 'AWAITING_CONFIRMATION', source: 'ATTENDANCE' },
      orderBy: { createdAt: 'asc' },
      include: {
        template: true,
        anomaly: { include: { subject: true, enrolment: { include: { student: true, class: true } } } },
      },
    });
    const school = await this.rendering.sampleContext().then((c) => c.school);
    const out = [];
    for (const d of drafts) {
      if (!d.anomaly) continue;
      const res = await this.recipients.resolve(d.recipientFilter);
      const s = res.students[0];
      const st = d.anomaly.enrolment.student;
      const student = s ?? { firstName: st.firstName, lastName: st.lastName, className: d.anomaly.enrolment.class.name };
      const ctx = { anomaly: d.anomaly, school };
      out.push({
        id: d.id,
        anomaly_id: d.anomaly.id,
        type: d.anomaly.type,
        date: toDay(d.anomaly.date),
        subject: d.anomaly.subject?.name ?? null,
        time_slot: d.anomaly.timeSlot,
        arrival_time: d.anomaly.arrivalTime,
        note: d.anomaly.note,
        student: { id: st.id, name: `${st.lastName} ${st.firstName}`, matricule: st.matricule },
        class: d.anomaly.enrolment.class.name,
        template_status: d.template.metaStatus,
        // "No contact" alerts cannot be confirmed (UC-01 alternative).
        has_contact: !!s,
        recipients: (s?.contacts ?? []).map((c) => ({ name: c.name, phone: c.phoneMasked })),
        previews: (s?.contacts.length ? s.contacts : [{ name: 'Parent' }]).map((c) =>
          fillBody(d.template.bodyPreview, this.rendering.render(d.template, student, c as { name: string }, ctx, {})),
        ),
        created_at: d.createdAt,
      });
    }
    return out;
  }

  async confirm(ids: string[], actorId: string) {
    const drafts = await this.prisma.dispatch.findMany({
      where: { id: { in: ids }, status: 'AWAITING_CONFIRMATION', source: 'ATTENDANCE' },
      include: { template: true },
    });
    const confirmed: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    for (const d of drafts) {
      if (d.template.metaStatus !== 'APPROVED') {
        skipped.push({ id: d.id, reason: 'TEMPLATE_NOT_APPROVED' });
        continue;
      }
      const res = await this.recipients.resolve(d.recipientFilter);
      if (res.messageCount === 0) {
        skipped.push({ id: d.id, reason: 'NO_CONTACT' });
        continue;
      }
      confirmed.push(d.id);
    }
    await this.dispatches.start(confirmed);
    for (const id of confirmed) await this.audit.log(actorId, 'CONFIRM', 'dispatch', id);
    await this.notifications.refreshAwaitingConfirmation();
    return { confirmed: confirmed.length, skipped };
  }

  /** Discarding asks for a short reason, kept in the log (§9.2). The anomaly itself stays recorded. */
  async discard(ids: string[], reason: string, actorId: string) {
    let n = 0;
    for (const id of ids) {
      const res = await this.prisma.dispatch.updateMany({
        where: { id, status: 'AWAITING_CONFIRMATION', source: 'ATTENDANCE' },
        data: { status: 'CANCELLED', cancelReason: reason },
      });
      if (res.count) {
        n++;
        await this.audit.log(actorId, 'DISCARD', 'dispatch', id, { reason });
      }
    }
    await this.notifications.refreshAwaitingConfirmation();
    return { discarded: n };
  }

  /** Anomaly history per student or class (FR-ATT-008). */
  async history(q: HistoryQuery) {
    const where: Prisma.AttendanceAnomalyWhereInput = {};
    if (q.student_id) where.enrolment = { studentId: q.student_id };
    else if (q.class_id) where.enrolment = { classId: q.class_id };
    if (q.type) where.type = q.type as AnomalyType;
    if (q.justified === 'true') where.isJustified = true;
    if (q.justified === 'false') where.isJustified = false;
    if (q.from || q.to) where.date = { ...(q.from ? { gte: parseDay(q.from) } : {}), ...(q.to ? { lte: parseDay(q.to) } : {}) };
    const rows = await this.prisma.attendanceAnomaly.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 5000,
      include: {
        subject: { select: { name: true } },
        enrolment: { include: { student: { select: { id: true, firstName: true, lastName: true, matricule: true } }, class: { select: { name: true } } } },
        dispatch: { select: { id: true, status: true } },
      },
    });
    return rows.map((a) => ({
      id: a.id,
      type: a.type,
      date: toDay(a.date),
      subject: a.subject?.name ?? null,
      time_slot: a.timeSlot,
      arrival_time: a.arrivalTime,
      note: a.note,
      is_justified: a.isJustified,
      justification_note: a.justificationNote,
      student: { id: a.enrolment.student.id, name: `${a.enrolment.student.lastName} ${a.enrolment.student.firstName}`, matricule: a.enrolment.student.matricule },
      class: a.enrolment.class.name,
      alert: a.dispatch,
    }));
  }
}
