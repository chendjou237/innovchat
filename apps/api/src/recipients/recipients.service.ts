import { Injectable } from '@nestjs/common';
import { RecipientFilter, compareClasses, recipientFilterSchema } from '@innovcare/shared';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../core/prisma.service';
import { Balance, LedgerService } from '../fees/ledger.service';
import { OrgService } from '../org/org.service';

export interface ResolvedContact {
  id: string;
  name: string;
  phoneE164: string; // encrypted
  phoneMasked: string;
}

export interface ResolvedStudent {
  studentId: string;
  enrolmentId: string;
  matricule: string;
  firstName: string;
  lastName: string;
  classId: string;
  className: string;
  departmentId: string;
  contacts: ResolvedContact[];
  balance?: Balance;
}

export interface Resolution {
  /** Students with at least one usable contact. */
  students: ResolvedStudent[];
  /** Students targeted but without any active contact (FR-FLT-007). */
  withoutContact: ResolvedStudent[];
  messageCount: number;
}

export function parseFilter(raw: unknown): RecipientFilter {
  return recipientFilterSchema.parse(raw ?? {});
}

export function isEmptyFilter(f: RecipientFilter): boolean {
  return !f.whole_school && !f.department_ids.length && !f.class_ids.length && !f.student_ids.length;
}

/**
 * Turns a recipient filter into students and parent contacts (FR-FLT-001..008).
 * Levels combine as a union, exclusions are removed, only ACTIVE students enrolled in
 * the active year are kept, opted-out contacts are dropped. With fee_installment_unpaid
 * set, only students whose balance for that installment is above zero remain (FR-FEE-005).
 * Called again at send time, so class changes are honoured (FR-SCH-002).
 */
@Injectable()
export class RecipientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly org: OrgService,
    private readonly ledger: LedgerService,
  ) {}

  async resolve(rawFilter: unknown, tx?: Tx): Promise<Resolution> {
    const f = parseFilter(rawFilter);
    const empty: Resolution = { students: [], withoutContact: [], messageCount: 0 };
    if (isEmptyFilter(f)) return empty;
    const db = tx ?? this.prisma;
    const year = await this.org.activeYear(tx);

    const where: Prisma.EnrolmentWhereInput = { academicYearId: year.id, student: { status: 'ACTIVE' } };
    if (!f.whole_school) {
      const or: Prisma.EnrolmentWhereInput[] = [];
      if (f.department_ids.length) or.push({ class: { departmentId: { in: f.department_ids } } });
      if (f.class_ids.length) or.push({ classId: { in: f.class_ids } });
      if (f.student_ids.length) or.push({ studentId: { in: f.student_ids } });
      where.OR = or;
    }
    if (f.exclude_student_ids.length) where.studentId = { notIn: f.exclude_student_ids };

    const enrolments = await db.enrolment.findMany({
      where,
      select: {
        id: true,
        classId: true,
        class: { select: { name: true, departmentId: true } },
        student: {
          select: {
            id: true,
            matricule: true,
            firstName: true,
            lastName: true,
            contacts: {
              where: { isOptedOut: false },
              select: { id: true, name: true, phoneE164: true, phoneMasked: true },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
      orderBy: [{ class: { name: 'asc' } }, { student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
    });

    let rows: ResolvedStudent[] = enrolments.map((e) => ({
      studentId: e.student.id,
      enrolmentId: e.id,
      matricule: e.student.matricule,
      firstName: e.student.firstName,
      lastName: e.student.lastName,
      classId: e.classId,
      className: e.class.name,
      departmentId: e.class.departmentId,
      contacts: e.student.contacts,
    }));

    if (f.fee_installment_unpaid) {
      const balances = await this.ledger.balances(f.fee_installment_unpaid, rows.map((r) => r.enrolmentId), tx);
      rows = rows
        .map((r) => ({ ...r, balance: balances.get(r.enrolmentId) }))
        .filter((r) => (r.balance?.balance ?? 0) > 0);
    }

    const students = rows.filter((r) => r.contacts.length > 0);
    return {
      students,
      withoutContact: rows.filter((r) => r.contacts.length === 0),
      // One message per student per active contact; no de-duplication in v1 (FR-FLT-008).
      messageCount: students.reduce((n, s) => n + s.contacts.length, 0),
    };
  }

  /** Departments → classes of the active year, with active student counts (selector tree, §9.1). */
  async tree() {
    const year = await this.org.activeYearOrNull();
    if (!year) return { year: null, departments: [] };
    const departments = await this.prisma.department.findMany({
      orderBy: { name: 'asc' },
      include: {
        classes: {
          where: { academicYearId: year.id },
          orderBy: [{ level: 'asc' }, { name: 'asc' }],
          include: { _count: { select: { enrolments: { where: { student: { status: 'ACTIVE' } } } } } },
        },
      },
    });
    return {
      year: { id: year.id, label: year.label },
      departments: departments.map((d) => ({
        id: d.id,
        name: d.name,
        classes: [...d.classes].sort(compareClasses).map((c) => ({ id: c.id, name: c.name, students: c._count.enrolments })),
      })),
    };
  }
}
