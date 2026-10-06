import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { contactSchema, createStudentSchema, updateContactSchema, updateStudentSchema } from '@innovcare/shared';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth.service';
import { AuditService } from '../core/audit.service';
import { ZodPipe } from '../core/zod.pipe';
import { StudentsService } from './students.service';

/** Students and parent contacts (FR-STU-001..005, NFR-14). */
@Controller('students')
export class StudentsController {
  constructor(
    private readonly students: StudentsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(
    @Query('q') q?: string,
    @Query('class_id') classId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    return this.students.list({ q, classId, status, page: Number(page) || 1, pageSize: Number(pageSize) || 50 });
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.students.detail(id);
  }

  @Post()
  async create(@CurrentUser() me: SessionUser, @Body(new ZodPipe(createStudentSchema)) body: z.infer<typeof createStudentSchema>) {
    const s = await this.students.create(body);
    await this.audit.log(me.id, 'CREATE', 'student', s.id, { matricule: s.matricule });
    return s;
  }

  @Patch(':id')
  async update(
    @CurrentUser() me: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateStudentSchema)) body: z.infer<typeof updateStudentSchema>,
  ) {
    const s = await this.students.update(id, body);
    await this.audit.log(me.id, 'UPDATE', 'student', id, body);
    return s;
  }

  /** Archive (students are never hard-deleted, §4.3). */
  @Delete(':id')
  async archive(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.students.update(id, { status: 'ARCHIVED' });
    await this.audit.log(me.id, 'ARCHIVE', 'student', id);
    return { ok: true };
  }

  @Get(':id/export')
  async exportData(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.audit.log(me.id, 'EXPORT_PERSONAL_DATA', 'student', id);
    return this.students.exportData(id);
  }

  @Post(':id/erase')
  async erase(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.students.erase(id);
    await this.audit.log(me.id, 'ERASE_PERSONAL_DATA', 'student', id);
    return { ok: true };
  }

  @Post(':id/contacts')
  async addContact(
    @CurrentUser() me: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(contactSchema)) body: z.infer<typeof contactSchema>,
  ) {
    const c = await this.students.addContact(id, body);
    await this.audit.log(me.id, 'CREATE', 'parent_contact', c.id, { studentId: id });
    return c;
  }

  @Patch(':id/contacts/:contactId')
  async updateContact(
    @CurrentUser() me: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body(new ZodPipe(updateContactSchema)) body: z.infer<typeof updateContactSchema>,
  ) {
    const r = await this.students.updateContact(id, contactId, body);
    await this.audit.log(me.id, 'UPDATE', 'parent_contact', contactId, { ...body, phone: body.phone ? '***' : undefined });
    return r;
  }

  @Delete(':id/contacts/:contactId')
  async removeContact(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Param('contactId', ParseUUIDPipe) contactId: string) {
    const r = await this.students.removeContact(id, contactId);
    await this.audit.log(me.id, 'DELETE', 'parent_contact', contactId);
    return r;
  }
}
