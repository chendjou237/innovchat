import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import {
  confirmAlertsSchema,
  discardAlertsSchema,
  formatDayFr,
  justifyAnomalySchema,
  recordAnomaliesSchema,
  updateAnomalySchema,
} from '@innovcare/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth.service';
import { sendXlsx } from '../core/xlsx';
import { ZodPipe } from '../core/zod.pipe';
import { AttendanceService } from './attendance.service';

const ALERT_FR: Record<string, string> = {
  AWAITING_CONFIRMATION: 'À confirmer',
  PROCESSING: 'En cours',
  COMPLETED: 'Envoyée',
  COMPLETED_WITH_FAILURES: 'Envoyée avec échecs',
  CANCELLED: 'Écartée',
};

@Controller()
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post('attendance/anomalies')
  record(@CurrentUser() me: SessionUser, @Body(new ZodPipe(recordAnomaliesSchema)) body: z.infer<typeof recordAnomaliesSchema>) {
    return this.attendance.record(body, me.id);
  }

  @Get('attendance/anomalies')
  history(@Query() q: Record<string, string>) {
    return this.attendance.history(q);
  }

  @Get('attendance/anomalies/export')
  async export(@Query() q: Record<string, string>, @Res() res: Response) {
    const rows = await this.attendance.history(q);
    await sendXlsx(
      res,
      'absences-retards.xlsx',
      'Anomalies',
      [
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Type', key: 'type', width: 10 },
        { header: 'Élève', key: 'eleve', width: 28 },
        { header: 'Matricule', key: 'matricule', width: 14 },
        { header: 'Classe', key: 'classe', width: 10 },
        { header: 'Matière', key: 'matiere', width: 18 },
        { header: 'Créneau', key: 'creneau', width: 14 },
        { header: 'Arrivée', key: 'arrivee', width: 10 },
        { header: 'Note', key: 'note', width: 24 },
        { header: 'Justifiée', key: 'justifiee', width: 10 },
        { header: 'Justification', key: 'justification', width: 24 },
        { header: 'Alerte', key: 'alerte', width: 18 },
      ],
      rows.map((r) => ({
        date: formatDayFr(r.date),
        type: r.type === 'ABSENCE' ? 'Absence' : 'Retard',
        eleve: r.student.name,
        matricule: r.student.matricule,
        classe: r.class,
        matiere: r.subject ?? '',
        creneau: r.time_slot ?? '',
        arrivee: r.arrival_time ?? '',
        note: r.note ?? '',
        justifiee: r.is_justified ? 'Oui' : 'Non',
        justification: r.justification_note ?? '',
        alerte: r.alert ? (ALERT_FR[r.alert.status] ?? r.alert.status) : '',
      })),
    );
  }

  @Patch('attendance/anomalies/:id')
  update(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateAnomalySchema)) body: z.infer<typeof updateAnomalySchema>) {
    return this.attendance.update(id, body, me.id);
  }

  @Delete('attendance/anomalies/:id')
  remove(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.attendance.remove(id, me.id);
  }

  @Post('attendance/anomalies/:id/justify')
  @HttpCode(200)
  justify(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(justifyAnomalySchema)) body: z.infer<typeof justifyAnomalySchema>) {
    return this.attendance.justify(id, body.note, me.id);
  }

  @Get('alerts/pending')
  pending() {
    return this.attendance.pending();
  }

  @Post('alerts/confirm')
  @HttpCode(200)
  confirm(@CurrentUser() me: SessionUser, @Body(new ZodPipe(confirmAlertsSchema)) body: z.infer<typeof confirmAlertsSchema>) {
    return this.attendance.confirm(body.alert_ids, me.id);
  }

  @Post('alerts/discard')
  @HttpCode(200)
  discard(@CurrentUser() me: SessionUser, @Body(new ZodPipe(discardAlertsSchema)) body: z.infer<typeof discardAlertsSchema>) {
    return this.attendance.discard(body.alert_ids, body.reason, me.id);
  }
}
