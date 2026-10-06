import { Injectable } from '@nestjs/common';
import { RecipientFilter, formatDayFr, parseDay, toDay, triggerInstant } from '@innovcare/shared';
import { Prisma } from '@prisma/client';
import { AuditService } from '../core/audit.service';
import { badRequest, conflict, notFound } from '../core/errors';
import { PrismaService, Tx } from '../core/prisma.service';
import { DispatchesService } from '../dispatches/dispatches.service';
import { OrgService } from '../org/org.service';
import { TemplatesService } from '../templates/templates.service';
import { LedgerService, amountFor } from './ledger.service';
import { triggerLabel } from '../calendar/calendar.service';

export interface InstallmentInput {
  name: string;
  due_date: string;
  default_amount_xaf: number;
  class_amounts: Record<string, number>;
}

export interface RuleInput {
  installment_id: string;
  days_offset: number;
  send_time: string;
  recipient_filter: RecipientFilter;
  is_enabled: boolean;
}

/** Installments, balances, payments and reminders (FR-FEE-001..007, UC-03). */
@Injectable()
export class FeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly org: OrgService,
    private readonly ledger: LedgerService,
    private readonly dispatches: DispatchesService,
    private readonly templates: TemplatesService,
    private readonly audit: AuditService,
  ) {}

  // --- Installments ---------------------------------------------------------------
  async installments() {
    const year = await this.org.activeYearOrNull();
    if (!year) return [];
    const list = await this.prisma.feeInstallment.findMany({
      where: { academicYearId: year.id },
      orderBy: { dueDate: 'asc' },
      include: { rules: { orderBy: { daysOffset: 'asc' }, include: { dispatch: { select: { id: true, status: true, scheduledFor: true } } } } },
    });
    const out = [];
    for (const i of list) {
      const balances = await this.ledger.balances(i.id);
      let due = 0;
      let paid = 0;
      let unpaid = 0;
      for (const b of balances.values()) {
        due += b.due;
        paid += b.paid;
        if (b.balance > 0) unpaid++;
      }
      out.push({ ...i, due_date: toDay(i.dueDate), totals: { due, paid, balance: Math.max(0, due - paid), unpaid_students: unpaid, students: balances.size } });
    }
    return out;
  }

  async createInstallment(input: InstallmentInput, actorId: string) {
    const year = await this.org.activeYear();
    const inst = await this.prisma.$transaction(async (tx) => {
      const i = await tx.feeInstallment.create({
        data: { academicYearId: year.id, name: input.name, dueDate: parseDay(input.due_date), defaultAmountXaf: input.default_amount_xaf, classAmounts: input.class_amounts },
      });
      await this.ledger.syncInstallment(i.id, tx);
      await this.audit.log(actorId, 'CREATE', 'fee_installment', i.id, { ...input }, tx);
      return i;
    }, { timeout: 60_000 });
    return inst;
  }

  async updateInstallment(id: string, input: InstallmentInput, actorId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.feeInstallment.update({
        where: { id },
        data: { name: input.name, dueDate: parseDay(input.due_date), defaultAmountXaf: input.default_amount_xaf, classAmounts: input.class_amounts },
      });
      await this.ledger.syncInstallment(id, tx);
      // The due date moves the reminder rules' dispatches.
      for (const r of await tx.feeReminderRule.findMany({ where: { installmentId: id } })) await this.materializeRule(r.id, actorId, tx);
      await this.audit.log(actorId, 'UPDATE', 'fee_installment', id, { ...input }, tx);
    }, { timeout: 60_000 });
    return { ok: true };
  }

  async deleteInstallment(id: string, actorId: string) {
    const payments = await this.prisma.payment.count({ where: { studentFee: { installmentId: id } } });
    if (payments > 0) throw conflict('INSTALLMENT_HAS_PAYMENTS', 'Des paiements sont enregistrés pour cette tranche.');
    await this.prisma.$transaction(async (tx) => {
      for (const r of await tx.feeReminderRule.findMany({ where: { installmentId: id }, include: { dispatch: true } })) {
        if (r.dispatch?.status === 'SCHEDULED') await this.dispatches.cancel(r.dispatch.id, actorId, 'Tranche supprimée', tx);
      }
      await tx.feeInstallment.delete({ where: { id } });
      await this.audit.log(actorId, 'DELETE', 'fee_installment', id, {}, tx);
    });
    return { ok: true };
  }

  // --- Balances ------------------------------------------------------------------------
  /** Per-student balances for an installment, optionally for one class (FR-FEE-004). */
  async studentBalances(installmentId: string, classId?: string, onlyUnpaid = false) {
    const inst = await this.prisma.feeInstallment.findUnique({ where: { id: installmentId } });
    if (!inst) throw notFound('Tranche introuvable');
    const enrolments = await this.prisma.enrolment.findMany({
      where: { academicYearId: inst.academicYearId, ...(classId ? { classId } : {}), student: { status: 'ACTIVE' } },
      include: { student: { select: { id: true, firstName: true, lastName: true, matricule: true } }, class: { select: { id: true, name: true } } },
      orderBy: [{ class: { name: 'asc' } }, { student: { lastName: 'asc' } }],
    });
    const balances = await this.ledger.balances(installmentId, enrolments.map((e) => e.id));
    const overrides = await this.prisma.studentFee.findMany({ where: { installmentId, isOverride: true }, select: { enrolmentId: true } });
    const overridden = new Set(overrides.map((o) => o.enrolmentId));
    const rows = enrolments.map((e) => {
      const b = balances.get(e.id) ?? { due: amountFor(inst, e.classId), paid: 0, balance: amountFor(inst, e.classId) };
      return {
        student: { id: e.student.id, name: `${e.student.lastName} ${e.student.firstName}`, matricule: e.student.matricule },
        class: e.class,
        due: b.due,
        paid: b.paid,
        balance: b.balance,
        is_override: overridden.has(e.id),
      };
    });
    return onlyUnpaid ? rows.filter((r) => r.balance > 0) : rows;
  }

  /** Summary per class: number of unpaid students and amount outstanding. */
  async classSummary(installmentId: string) {
    const rows = await this.studentBalances(installmentId);
    const map = new Map<string, { class_id: string; class_name: string; students: number; unpaid: number; due: number; paid: number; balance: number }>();
    for (const r of rows) {
      const m = map.get(r.class.id) ?? { class_id: r.class.id, class_name: r.class.name, students: 0, unpaid: 0, due: 0, paid: 0, balance: 0 };
      m.students++;
      if (r.balance > 0) m.unpaid++;
      m.due += r.due;
      m.paid += r.paid;
      m.balance += r.balance;
      map.set(r.class.id, m);
    }
    return [...map.values()];
  }

  private async studentFee(studentId: string, installmentId: string, tx?: Tx) {
    const db = tx ?? this.prisma;
    const inst = await db.feeInstallment.findUnique({ where: { id: installmentId } });
    if (!inst) throw notFound('Tranche introuvable');
    const enrolment = await db.enrolment.findUnique({ where: { studentId_academicYearId: { studentId, academicYearId: inst.academicYearId } } });
    if (!enrolment) throw badRequest('STUDENT_NOT_ENROLLED', "L'élève n'est pas inscrit pour l'année de cette tranche.");
    await this.ledger.syncEnrolments([enrolment.id], tx);
    return db.studentFee.findUniqueOrThrow({ where: { enrolmentId_installmentId: { enrolmentId: enrolment.id, installmentId } } });
  }

  /** Individual amount (scholarship, sibling discount…) or back to the class amount when null (FR-FEE-002). */
  async override(studentId: string, installmentId: string, amount: number | null, actorId: string) {
    const fee = await this.studentFee(studentId, installmentId);
    if (amount === null) {
      await this.prisma.studentFee.update({ where: { id: fee.id }, data: { isOverride: false } });
      const e = await this.prisma.enrolment.findUniqueOrThrow({ where: { id: fee.enrolmentId } });
      await this.ledger.syncEnrolments([e.id]);
    } else {
      await this.prisma.studentFee.update({ where: { id: fee.id }, data: { amountDueXaf: amount, isOverride: true } });
    }
    await this.audit.log(actorId, 'OVERRIDE', 'student_fee', fee.id, { amount });
    return { ok: true };
  }

  // --- Payments --------------------------------------------------------------------------
  async addPayment(input: { student_id: string; installment_id: string; amount_xaf: number; paid_on: string; reference: string | null }, actorId: string, importJobId?: string, tx?: Tx) {
    const fee = await this.studentFee(input.student_id, input.installment_id, tx);
    const p = await (tx ?? this.prisma).payment.create({
      data: { studentFeeId: fee.id, amountXaf: input.amount_xaf, paidOn: parseDay(input.paid_on), reference: input.reference, importJobId },
    });
    if (!importJobId) await this.audit.log(actorId, 'CREATE', 'payment', p.id, { ...input }, tx);
    return p;
  }

  async payments(q: { student_id?: string; installment_id?: string }) {
    const rows = await this.prisma.payment.findMany({
      where: {
        studentFee: {
          ...(q.installment_id ? { installmentId: q.installment_id } : {}),
          ...(q.student_id ? { enrolment: { studentId: q.student_id } } : {}),
        },
      },
      orderBy: { paidOn: 'desc' },
      take: 500,
      include: { studentFee: { include: { installment: { select: { name: true } }, enrolment: { include: { student: { select: { id: true, firstName: true, lastName: true, matricule: true } }, class: { select: { name: true } } } } } } },
    });
    return rows.map((p) => ({
      id: p.id,
      amount_xaf: p.amountXaf,
      paid_on: toDay(p.paidOn),
      reference: p.reference,
      imported: !!p.importJobId,
      installment: p.studentFee.installment.name,
      student: { id: p.studentFee.enrolment.student.id, name: `${p.studentFee.enrolment.student.lastName} ${p.studentFee.enrolment.student.firstName}`, matricule: p.studentFee.enrolment.student.matricule },
      class: p.studentFee.enrolment.class.name,
    }));
  }

  async deletePayment(id: string, actorId: string) {
    await this.prisma.payment.delete({ where: { id } });
    await this.audit.log(actorId, 'DELETE', 'payment', id);
    return { ok: true };
  }

  // --- Reminders -------------------------------------------------------------------------
  /** Fee reminder to unpaid balances only, each with the student's own values (FR-FEE-005/006, UC-03). */
  async prepareReminder(input: { installment_id: string; recipients_filter: RecipientFilter; scheduled_for: string | null; preview_only: boolean }, actorId: string) {
    const inst = await this.prisma.feeInstallment.findUnique({ where: { id: input.installment_id } });
    if (!inst) throw notFound('Tranche introuvable');
    const template = await this.templates.forPurpose('PAYMENT');
    const filter: RecipientFilter = { ...input.recipients_filter, fee_installment_unpaid: inst.id };
    if (input.preview_only) {
      return { template_id: template.id, ...(await this.dispatches.preview({ template_id: template.id, parameters: {}, recipients_filter: filter })) };
    }
    const { dispatch, resolution } = await this.dispatches.create(
      { template_id: template.id, parameters: {}, recipients_filter: filter, scheduled_for: input.scheduled_for, title: `Rappel ${inst.name} du ${formatDayFr(toDay(input.scheduled_for ? new Date(input.scheduled_for) : new Date())).slice(0, 5)}` },
      actorId,
    );
    return { id: dispatch.id, status: dispatch.status, students: resolution.students.length, messages: resolution.messageCount, estimated_cost_xaf: dispatch.estimatedCostXaf };
  }

  async createRule(input: RuleInput, actorId: string) {
    const rule = await this.prisma.feeReminderRule.create({
      data: {
        installmentId: input.installment_id,
        daysOffset: input.days_offset,
        sendTime: input.send_time,
        recipientFilter: input.recipient_filter as Prisma.InputJsonValue,
        isEnabled: input.is_enabled,
      },
    });
    await this.audit.log(actorId, 'CREATE', 'fee_reminder_rule', rule.id, { ...input });
    return this.prisma.$transaction((tx) => this.materializeRule(rule.id, actorId, tx), { timeout: 60_000 });
  }

  async updateRule(id: string, input: RuleInput, actorId: string) {
    await this.prisma.feeReminderRule.update({
      where: { id },
      data: { daysOffset: input.days_offset, sendTime: input.send_time, recipientFilter: input.recipient_filter as Prisma.InputJsonValue, isEnabled: input.is_enabled },
    });
    await this.audit.log(actorId, 'UPDATE', 'fee_reminder_rule', id, { ...input });
    return this.prisma.$transaction((tx) => this.materializeRule(id, actorId, tx), { timeout: 60_000 });
  }

  async deleteRule(id: string, actorId: string) {
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.feeReminderRule.findUniqueOrThrow({ where: { id }, include: { dispatch: true } });
      if (r.dispatch?.status === 'SCHEDULED') await this.dispatches.cancel(r.dispatch.id, actorId, 'Règle supprimée', tx);
      await tx.feeReminderRule.delete({ where: { id } });
      await this.audit.log(actorId, 'DELETE', 'fee_reminder_rule', id, {}, tx);
    });
    return { ok: true };
  }

  /**
   * Keeps a rule's scheduled dispatch in step with the rule (FR-FEE-007, off by default):
   * enabled and in the future → one SCHEDULED dispatch; disabled → pending dispatch cancelled.
   * Balances are re-read at send time, so students who paid in between are skipped.
   */
  async materializeRule(ruleId: string, actorId: string | null, tx: Tx) {
    const rule = await tx.feeReminderRule.findUniqueOrThrow({ where: { id: ruleId }, include: { installment: true, dispatch: true } });
    const at = triggerInstant(toDay(rule.installment.dueDate), rule.daysOffset, rule.sendTime);
    const filter: RecipientFilter = { ...(rule.recipientFilter as RecipientFilter), fee_installment_unpaid: rule.installmentId };
    const title = `Rappel ${rule.installment.name} (${triggerLabel(rule.daysOffset, rule.sendTime)})`;
    const d = rule.dispatch;
    const future = at.getTime() > Date.now() + 60_000;
    const pending = d?.status === 'SCHEDULED';

    if (!rule.isEnabled || !future) {
      if (pending) await this.dispatches.cancel(d!.id, actorId, rule.isEnabled ? 'Date passée' : 'Règle désactivée', tx);
    } else if (pending) {
      await this.dispatches.update(d!.id, { title, recipients_filter: filter, scheduled_for: at.toISOString() }, actorId, tx);
    } else if (!d || d.status === 'CANCELLED') {
      const template = await this.templates.forPurpose('PAYMENT');
      const { dispatch } = await this.dispatches.create(
        { template_id: template.id, parameters: {}, recipients_filter: filter, title, scheduled_for: at.toISOString() },
        actorId,
        { source: 'FEE_RULE', tx, allowUnapproved: true },
      );
      await tx.feeReminderRule.update({ where: { id: rule.id }, data: { dispatchId: dispatch.id } });
    }
    return tx.feeReminderRule.findUniqueOrThrow({ where: { id: rule.id }, include: { dispatch: { select: { id: true, status: true, scheduledFor: true } } } });
  }
}
