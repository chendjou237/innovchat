import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { createDispatchSchema, dispatchPreviewSchema, describeMetaError, formatInstantFr, resendSchema, updateDispatchSchema } from '@innovcare/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth.service';
import { sendXlsx } from '../core/xlsx';
import { ZodPipe } from '../core/zod.pipe';
import { RecipientsService } from '../recipients/recipients.service';
import { DispatchesService, ListQuery } from './dispatches.service';

const STATUS_FR: Record<string, string> = {
  QUEUED: 'En file',
  SENT: 'Envoyé',
  DELIVERED: 'Distribué',
  READ: 'Lu',
  RETRY_PENDING: 'Nouvel essai prévu',
  FAILED: 'Échec',
};

@Controller()
export class DispatchesController {
  constructor(
    private readonly dispatches: DispatchesService,
    private readonly recipients: RecipientsService,
  ) {}

  @Get('recipients/tree')
  tree() {
    return this.recipients.tree();
  }

  @Post('dispatches/preview')
  @HttpCode(200)
  preview(@Body(new ZodPipe(dispatchPreviewSchema)) body: z.infer<typeof dispatchPreviewSchema>) {
    return this.dispatches.preview(body);
  }

  @Post('dispatches')
  async create(@CurrentUser() me: SessionUser, @Body(new ZodPipe(createDispatchSchema)) body: z.infer<typeof createDispatchSchema>) {
    const { dispatch, resolution } = await this.dispatches.create(body, me.id);
    return {
      id: dispatch.id,
      status: dispatch.status,
      students: resolution.students.length,
      messages: resolution.messageCount,
      students_without_contact: resolution.withoutContact.length,
      estimated_cost_xaf: dispatch.estimatedCostXaf,
    };
  }

  @Get('dispatches')
  list(@Query() q: Record<string, string>) {
    return this.dispatches.list(this.listQuery(q));
  }

  @Get('dispatches/scheduled')
  scheduled() {
    return this.dispatches.scheduled();
  }

  /** History export to Excel (FR-DLV-006): one row per message. */
  @Get('dispatches/export')
  async export(@Query() q: Record<string, string>, @Res() res: Response) {
    const { items } = await this.dispatches.list({ ...this.listQuery(q), page: 1, page_size: 200 });
    const rows: Record<string, unknown>[] = [];
    for (const d of items) {
      for (const m of await this.dispatches.messages(d.id, q.message_status)) {
        rows.push({
          envoi: d.title,
          date: formatInstantFr(d.startedAt ?? d.createdAt),
          type: d.purpose,
          eleve: m.student.name,
          matricule: m.student.matricule,
          classe: m.student.class,
          parent: m.contact.name,
          numero: m.phoneMasked,
          statut: STATUS_FR[m.status] ?? m.status,
          erreur: m.status === 'FAILED' ? describeMetaError(m.errorCode, m.errorMessage) : '',
        });
      }
    }
    await sendXlsx(res, 'historique-envois.xlsx', 'Historique', [
      { header: 'Envoi', key: 'envoi', width: 36 },
      { header: 'Date', key: 'date', width: 18 },
      { header: 'Type', key: 'type', width: 12 },
      { header: 'Élève', key: 'eleve', width: 28 },
      { header: 'Matricule', key: 'matricule', width: 14 },
      { header: 'Classe', key: 'classe', width: 10 },
      { header: 'Parent', key: 'parent', width: 24 },
      { header: 'Numéro', key: 'numero', width: 18 },
      { header: 'Statut', key: 'statut', width: 16 },
      { header: 'Erreur', key: 'erreur', width: 30 },
    ], rows);
  }

  @Get('dispatches/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.dispatches.get(id);
  }

  @Patch('dispatches/:id')
  update(
    @CurrentUser() me: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateDispatchSchema)) body: z.infer<typeof updateDispatchSchema>,
  ) {
    return this.dispatches.update(id, body, me.id);
  }

  @Post('dispatches/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.dispatches.cancel(id, me.id);
  }

  @Get('dispatches/:id/messages')
  messages(@Param('id', ParseUUIDPipe) id: string, @Query('status') status?: string) {
    return this.dispatches.messages(id, status);
  }

  @Post('dispatches/:id/resend-failed')
  @HttpCode(200)
  resendFailed(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.dispatches.resendFailed(id, me.id);
  }

  @Post('messages/:id/resend')
  @HttpCode(200)
  resend(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(resendSchema)) body: z.infer<typeof resendSchema>) {
    return this.dispatches.resend(id, body.phone || undefined, me.id);
  }

  private listQuery(q: Record<string, string>): ListQuery {
    return { ...q, page: Number(q.page) || 1, page_size: Number(q.page_size) || 50 };
  }
}
