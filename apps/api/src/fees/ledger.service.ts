import { Injectable } from '@nestjs/common';
import { FeeInstallment, Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../core/prisma.service';

export interface Balance {
  studentFeeId: string;
  enrolmentId: string;
  due: number;
  paid: number;
  balance: number;
}

export function amountFor(installment: Pick<FeeInstallment, 'defaultAmountXaf' | 'classAmounts'>, classId: string): number {
  const perClass = (installment.classAmounts ?? {}) as Record<string, number>;
  return typeof perClass[classId] === 'number' ? perClass[classId] : installment.defaultAmountXaf;
}

/**
 * Keeps one STUDENT_FEE row per enrolment and installment, and computes balances
 * (FR-FEE-001..004). Rows marked isOverride keep the Administrator's amount.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates missing rows and re-prices non-override rows for the given enrolments. */
  async syncEnrolments(enrolmentIds: string[], tx?: Tx) {
    if (enrolmentIds.length === 0) return;
    const db = tx ?? this.prisma;
    const enrolments = await db.enrolment.findMany({ where: { id: { in: enrolmentIds } }, select: { id: true, classId: true, academicYearId: true } });
    const yearIds = [...new Set(enrolments.map((e) => e.academicYearId))];
    const installments = await db.feeInstallment.findMany({ where: { academicYearId: { in: yearIds } } });
    if (installments.length === 0) return;
    const existing = await db.studentFee.findMany({ where: { enrolmentId: { in: enrolmentIds } } });
    const byKey = new Map(existing.map((f) => [`${f.enrolmentId}:${f.installmentId}`, f]));

    const toCreate: Prisma.StudentFeeCreateManyInput[] = [];
    for (const e of enrolments) {
      for (const i of installments.filter((i) => i.academicYearId === e.academicYearId)) {
        const amount = amountFor(i, e.classId);
        const row = byKey.get(`${e.id}:${i.id}`);
        if (!row) toCreate.push({ enrolmentId: e.id, installmentId: i.id, amountDueXaf: amount });
        else if (!row.isOverride && row.amountDueXaf !== amount) {
          await db.studentFee.update({ where: { id: row.id }, data: { amountDueXaf: amount } });
        }
      }
    }
    if (toCreate.length) await db.studentFee.createMany({ data: toCreate, skipDuplicates: true });
  }

  /** After an installment is created or its amounts change. */
  async syncInstallment(installmentId: string, tx?: Tx) {
    const db = tx ?? this.prisma;
    const inst = await db.feeInstallment.findUniqueOrThrow({ where: { id: installmentId } });
    const enrolments = await db.enrolment.findMany({ where: { academicYearId: inst.academicYearId }, select: { id: true } });
    await this.syncEnrolments(enrolments.map((e) => e.id), tx);
  }

  /** Balance per enrolment for one installment; optionally restricted to some enrolments. */
  async balances(installmentId: string, enrolmentIds?: string[], tx?: Tx): Promise<Map<string, Balance>> {
    const db = tx ?? this.prisma;
    const fees = await db.studentFee.findMany({
      where: { installmentId, ...(enrolmentIds ? { enrolmentId: { in: enrolmentIds } } : {}) },
      select: { id: true, enrolmentId: true, amountDueXaf: true },
    });
    const paid = await db.payment.groupBy({
      by: ['studentFeeId'],
      where: { studentFeeId: { in: fees.map((f) => f.id) } },
      _sum: { amountXaf: true },
    });
    const paidBy = new Map(paid.map((p) => [p.studentFeeId, p._sum.amountXaf ?? 0]));
    const out = new Map<string, Balance>();
    for (const f of fees) {
      const p = paidBy.get(f.id) ?? 0;
      out.set(f.enrolmentId, { studentFeeId: f.id, enrolmentId: f.enrolmentId, due: f.amountDueXaf, paid: p, balance: Math.max(0, f.amountDueXaf - p) });
    }
    return out;
  }
}
