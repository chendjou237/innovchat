import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { createTemplateSchema, updateTemplateSchema } from '@innovcare/shared';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth.service';
import { AuditService } from '../core/audit.service';
import { AppError } from '../core/errors';
import { ZodPipe } from '../core/zod.pipe';
import { TemplatesService } from './templates.service';

@Controller('templates')
export class TemplatesController {
  constructor(
    private readonly templates: TemplatesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.templates.list();
  }

  @Post('sync')
  @HttpCode(200)
  async sync(@CurrentUser() me: SessionUser) {
    try {
      const r = await this.templates.sync();
      await this.audit.log(me.id, 'SYNC', 'message_template', null, r);
      return r;
    } catch (e) {
      throw new AppError(502, 'META_SYNC_FAILED', `Synchronisation impossible : ${(e as Error).message}`);
    }
  }

  /** Registers a template already submitted in WhatsApp Manager (§6.2). */
  @Post()
  async create(@CurrentUser() me: SessionUser, @Body(new ZodPipe(createTemplateSchema)) body: z.infer<typeof createTemplateSchema>) {
    const t = await this.templates.create(body);
    await this.audit.log(me.id, 'CREATE', 'message_template', t.id, { meta_name: t.metaName });
    return t;
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.get(id);
  }

  @Patch(':id')
  async update(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateTemplateSchema)) body: z.infer<typeof updateTemplateSchema>) {
    const t = await this.templates.update(id, body);
    await this.audit.log(me.id, 'UPDATE', 'message_template', id, body);
    return t;
  }

  @Post(':id/preview')
  @HttpCode(200)
  preview(@Param('id', ParseUUIDPipe) id: string, @Body() body: { student_id?: string; parameters?: Record<string, string> }) {
    return this.templates.preview(id, body?.student_id || undefined, body?.parameters ?? {});
  }
}
