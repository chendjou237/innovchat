import { Injectable } from '@nestjs/common';
import { PromotionInput, compareClasses, parseDay } from '@innovcare/shared';
import { AuditService } from '../core/audit.service';
import { badRequest } from '../core/errors';
import { PrismaService } from '../core/prisma.service';
import { OrgService } from '../org/org.service';

/**
 * Year-end promotion (FR-PRO-001..005): creates the next year with a copy of the
 * current classes, maps each class to a next-year class (or "Leaving school"), records
 * each student's outcome, creates the new enrolments and switches the active year.
 * History stays attached to the previous year's enrolments.
 */
@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly org: OrgService,
    private readonly audit: AuditService,
  ) {}

  /** Current classes with their students, and a summary of the given mapping. */
  async preview(input: Partial<PromotionInput>) {
    const year = await this.org.activeYear();
    const unsorted = await this.prisma.class.findMany({
      where: { academicYearId: year.id },
      include: {
        department: { select: { name: true } },
        enrolments: {
          where: { student: { status: 'ACTIVE' } },
          include: { student: { select: { id: true, firstName: true, lastName: true, matricule: true } } },
          orderBy: { student: { lastName: 'asc' } },
        },
      },
    });
    const classes = unsorted.sort(compareClasses);
    const map = input.class_map ?? {};
    const outcomes = input.outcomes ?? {};
    const summary: Record<string, { promoted: number; repeating: number }> = {};
    let leaving = 0;
    const unmapped: string[] = [];
    for (const c of classes) {
      if (!(c.id in map)) unmapped.push(c.name);
      for (const e of c.enrolments) {
        const target = map[c.id];
        const outcome = outcomes[e.studentId] ?? (target === null ? 'LEFT' : 'PROMOTED');
        if (outcome === 'LEFT') leaving++;
        else {
          const name = outcome === 'REPEATING' ? c.name : (target ?? c.name);
          summary[name] ??= { promoted: 0, repeating: 0 };
          summary[name][outcome === 'REPEATING' ? 'repeating' : 'promoted']++;
        }
      }
    }
    return {
      current_year: { id: year.id, label: year.label, start_date: year.startDate, end_date: year.endDate },
      classes: classes.map((c) => ({
        id: c.id,
        name: c.name,
        level: c.level,
        department: c.department.name,
        students: c.enrolments.map((e) => ({ id: e.student.id, name: `${e.student.lastName} ${e.student.firstName}`, matricule: e.student.matricule })),
      })),
      summary: { next_classes: summary, leaving, unmapped },
    };
  }

  async commit(input: PromotionInput, actorId: string) {
    const current = await this.org.activeYear();
    const classes = await this.prisma.class.findMany({ where: { academicYearId: current.id } });
    const names = new Set(classes.map((c) => c.name));
    for (const c of classes) {
      if (!(c.id in input.class_map)) throw badRequest('UNMAPPED_CLASS', `Classe non affectée : ${c.name}`);
      const target = input.class_map[c.id];
      if (target !== null && !names.has(target)) throw badRequest('UNKNOWN_TARGET_CLASS', `Classe de destination inconnue : ${target}`);
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const next = await tx.academicYear.create({
          data: { label: input.next_year.label, startDate: parseDay(input.next_year.startDate), endDate: parseDay(input.next_year.endDate) },
        });
        // FR-PRO-001: copy the current classes into the new year.
        const newByName = new Map<string, string>();
        for (const c of classes) {
          const n = await tx.class.create({ data: { name: c.name, level: c.level, departmentId: c.departmentId, academicYearId: next.id } });
          newByName.set(c.name, n.id);
        }
        const enrolments = await tx.enrolment.findMany({ where: { academicYearId: current.id, student: { status: 'ACTIVE' } } });
        const counts = { PROMOTED: 0, REPEATING: 0, LEFT: 0 };
        const byOutcome: Record<'PROMOTED' | 'REPEATING' | 'LEFT', string[]> = { PROMOTED: [], REPEATING: [], LEFT: [] };
        const newEnrolments: { studentId: string; classId: string; academicYearId: string }[] = [];
        const cls = new Map(classes.map((c) => [c.id, c]));
        for (const e of enrolments) {
          const target = input.class_map[e.classId];
          const outcome = input.outcomes[e.studentId] ?? (target === null ? 'LEFT' : 'PROMOTED');
          counts[outcome]++;
          byOutcome[outcome].push(e.id);
          if (outcome === 'LEFT') continue;
          const name = outcome === 'REPEATING' ? cls.get(e.classId)!.name : target!;
          newEnrolments.push({ studentId: e.studentId, classId: newByName.get(name)!, academicYearId: next.id });
        }
        for (const o of ['PROMOTED', 'REPEATING', 'LEFT'] as const) {
          if (byOutcome[o].length) await tx.enrolment.updateMany({ where: { id: { in: byOutcome[o] } }, data: { outcome: o } });
        }
        const leavingStudents = enrolments.filter((e) => byOutcome.LEFT.includes(e.id)).map((e) => e.studentId);
        if (leavingStudents.length) await tx.student.updateMany({ where: { id: { in: leavingStudents } }, data: { status: 'LEFT' } });
        await tx.enrolment.createMany({ data: newEnrolments });
        // FR-PRO-004: the new year becomes the active one.
        await tx.academicYear.update({ where: { id: current.id }, data: { isActive: false } });
        await tx.academicYear.update({ where: { id: next.id }, data: { isActive: true } });
        await this.audit.log(actorId, 'PROMOTION', 'academic_year', next.id, { from: current.label, to: next.label, ...counts }, tx);
        return { year: next, counts };
      },
      { timeout: 120_000 },
    );
    return result;
  }
}
