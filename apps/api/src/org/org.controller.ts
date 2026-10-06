import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { academicYearSchema, classSchema, compareClasses, departmentSchema, parseDay, subjectSchema } from '@innovcare/shared';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth.service';
import { AuditService } from '../core/audit.service';
import { conflict } from '../core/errors';
import { PrismaService } from '../core/prisma.service';
import { ZodPipe } from '../core/zod.pipe';
import { OrgService } from './org.service';

type YearInput = z.infer<typeof academicYearSchema>;

/** Academic years (FR-ORG-001). */
@Controller('academic-years')
export class AcademicYearsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.prisma.academicYear.findMany({
      orderBy: { startDate: 'desc' },
      include: { _count: { select: { classes: true, enrolments: true } } },
    });
  }

  @Post()
  async create(@CurrentUser() me: SessionUser, @Body(new ZodPipe(academicYearSchema)) body: YearInput) {
    const hasActive = await this.prisma.academicYear.count({ where: { isActive: true } });
    const year = await this.prisma.academicYear.create({
      data: { label: body.label, startDate: parseDay(body.startDate), endDate: parseDay(body.endDate), isActive: hasActive === 0 },
    });
    await this.audit.log(me.id, 'CREATE', 'academic_year', year.id, body);
    return year;
  }

  @Patch(':id')
  async update(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(academicYearSchema)) body: YearInput) {
    const year = await this.prisma.academicYear.update({
      where: { id },
      data: { label: body.label, startDate: parseDay(body.startDate), endDate: parseDay(body.endDate) },
    });
    await this.audit.log(me.id, 'UPDATE', 'academic_year', id, body);
    return year;
  }

  /** Makes this year the only active one. Normal switching happens through promotion (FR-PRO-004). */
  @Post(':id/activate')
  @HttpCode(200)
  async activate(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.$transaction([
      this.prisma.academicYear.updateMany({ where: { isActive: true }, data: { isActive: false } }),
      this.prisma.academicYear.update({ where: { id }, data: { isActive: true } }),
    ]);
    await this.audit.log(me.id, 'ACTIVATE', 'academic_year', id);
    return { ok: true };
  }

  @Delete(':id')
  async remove(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    const year = await this.prisma.academicYear.findUniqueOrThrow({ where: { id }, include: { _count: { select: { classes: true } } } });
    if (year.isActive) throw conflict('YEAR_ACTIVE', "L'année active ne peut pas être supprimée.");
    if (year._count.classes > 0) throw conflict('YEAR_HAS_CLASSES', 'Cette année contient des classes.');
    await this.prisma.academicYear.delete({ where: { id } });
    await this.audit.log(me.id, 'DELETE', 'academic_year', id);
    return { ok: true };
  }
}

/** Departments (FR-ORG-002). */
@Controller('departments')
export class DepartmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly org: OrgService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list() {
    const year = await this.org.activeYearOrNull();
    return this.prisma.department.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { classes: year ? { where: { academicYearId: year.id } } : true } } },
    });
  }

  @Post()
  async create(@CurrentUser() me: SessionUser, @Body(new ZodPipe(departmentSchema)) body: z.infer<typeof departmentSchema>) {
    const d = await this.prisma.department.create({ data: body });
    await this.audit.log(me.id, 'CREATE', 'department', d.id, body);
    return d;
  }

  @Patch(':id')
  async rename(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(departmentSchema)) body: z.infer<typeof departmentSchema>) {
    const d = await this.prisma.department.update({ where: { id }, data: body });
    await this.audit.log(me.id, 'UPDATE', 'department', id, body);
    return d;
  }

  @Delete(':id')
  async remove(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    const classes = await this.prisma.class.count({ where: { departmentId: id } });
    if (classes > 0) throw conflict('DEPARTMENT_HAS_CLASSES', 'Un département qui contient des classes ne peut pas être supprimé.');
    await this.prisma.department.delete({ where: { id } });
    await this.audit.log(me.id, 'DELETE', 'department', id);
    return { ok: true };
  }
}

/** Classes of the active year (FR-ORG-003). */
@Controller('classes')
export class ClassesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly org: OrgService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Query('academic_year_id') yearId?: string) {
    const academicYearId = yearId || (await this.org.activeYearOrNull())?.id;
    if (!academicYearId) return [];
    const classes = await this.prisma.class.findMany({
      where: { academicYearId },
      include: { department: true, _count: { select: { enrolments: { where: { student: { status: 'ACTIVE' } } } } } },
    });
    return classes.sort(compareClasses);
  }

  @Post()
  async create(@CurrentUser() me: SessionUser, @Body(new ZodPipe(classSchema)) body: z.infer<typeof classSchema>) {
    const year = await this.org.activeYear();
    const c = await this.prisma.class.create({ data: { ...body, academicYearId: year.id } });
    await this.audit.log(me.id, 'CREATE', 'class', c.id, body);
    return c;
  }

  @Patch(':id')
  async update(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(classSchema)) body: z.infer<typeof classSchema>) {
    const c = await this.prisma.class.update({ where: { id }, data: body });
    await this.audit.log(me.id, 'UPDATE', 'class', id, body);
    return c;
  }

  @Delete(':id')
  async remove(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    const n = await this.prisma.enrolment.count({ where: { classId: id } });
    if (n > 0) throw conflict('CLASS_HAS_STUDENTS', 'Cette classe contient des élèves.');
    await this.prisma.class.delete({ where: { id } });
    await this.audit.log(me.id, 'DELETE', 'class', id);
    return { ok: true };
  }
}

/** Subjects used when recording absences (FR-ORG-004). */
@Controller('subjects')
export class SubjectsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.prisma.subject.findMany({ orderBy: { name: 'asc' } });
  }

  @Post()
  async create(@CurrentUser() me: SessionUser, @Body(new ZodPipe(subjectSchema)) body: z.infer<typeof subjectSchema>) {
    const s = await this.prisma.subject.create({ data: body });
    await this.audit.log(me.id, 'CREATE', 'subject', s.id, body);
    return s;
  }

  @Patch(':id')
  async update(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(subjectSchema)) body: z.infer<typeof subjectSchema>) {
    const s = await this.prisma.subject.update({ where: { id }, data: body });
    await this.audit.log(me.id, 'UPDATE', 'subject', id, body);
    return s;
  }

  @Delete(':id')
  async remove(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    const used = await this.prisma.attendanceAnomaly.count({ where: { subjectId: id } });
    if (used > 0) {
      // Keep history intact: deactivate instead of deleting.
      await this.prisma.subject.update({ where: { id }, data: { isActive: false } });
      await this.audit.log(me.id, 'DEACTIVATE', 'subject', id);
      return { ok: true, deactivated: true };
    }
    await this.prisma.subject.delete({ where: { id } });
    await this.audit.log(me.id, 'DELETE', 'subject', id);
    return { ok: true };
  }
}

