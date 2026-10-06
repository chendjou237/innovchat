import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { installmentSchema, paymentSchema, prepareReminderSchema, reminderRuleSchema, studentFeeOverrideSchema } from '@innovcare/shared';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth.service';
import { badRequest } from '../core/errors';
import { ZodPipe } from '../core/zod.pipe';
import { FeesService } from './fees.service';

@Controller('fees')
export class FeesController {
  constructor(private readonly fees: FeesService) {}

  @Get('installments')
  installments() {
    return this.fees.installments();
  }

  @Post('installments')
  createInstallment(@CurrentUser() me: SessionUser, @Body(new ZodPipe(installmentSchema)) body: z.infer<typeof installmentSchema>) {
    return this.fees.createInstallment(body, me.id);
  }

  @Put('installments/:id')
  updateInstallment(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(installmentSchema)) body: z.infer<typeof installmentSchema>) {
    return this.fees.updateInstallment(id, body, me.id);
  }

  @Delete('installments/:id')
  deleteInstallment(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.fees.deleteInstallment(id, me.id);
  }

  @Get('installments/:id/classes')
  classSummary(@Param('id', ParseUUIDPipe) id: string) {
    return this.fees.classSummary(id);
  }

  /** Balances per student (unpaid list per class with unpaid=true). */
  @Get('students')
  students(@Query('installment_id') installmentId: string, @Query('class_id') classId?: string, @Query('unpaid') unpaid?: string) {
    if (!installmentId) throw badRequest('MISSING_INSTALLMENT', 'Paramètre installment_id requis.');
    return this.fees.studentBalances(installmentId, classId || undefined, unpaid === 'true');
  }

  @Put('students')
  override(@CurrentUser() me: SessionUser, @Body(new ZodPipe(studentFeeOverrideSchema)) body: z.infer<typeof studentFeeOverrideSchema>) {
    return this.fees.override(body.student_id, body.installment_id, body.amount_due_xaf, me.id);
  }

  @Get('payments')
  payments(@Query('student_id') studentId?: string, @Query('installment_id') installmentId?: string) {
    return this.fees.payments({ student_id: studentId, installment_id: installmentId });
  }

  @Post('payments')
  addPayment(@CurrentUser() me: SessionUser, @Body(new ZodPipe(paymentSchema)) body: z.infer<typeof paymentSchema>) {
    return this.fees.addPayment(body, me.id);
  }

  @Delete('payments/:id')
  deletePayment(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.fees.deletePayment(id, me.id);
  }

  @Post('reminders')
  @HttpCode(200)
  prepareReminder(@CurrentUser() me: SessionUser, @Body(new ZodPipe(prepareReminderSchema)) body: z.infer<typeof prepareReminderSchema>) {
    return this.fees.prepareReminder(body, me.id);
  }

  @Post('rules')
  createRule(@CurrentUser() me: SessionUser, @Body(new ZodPipe(reminderRuleSchema)) body: z.infer<typeof reminderRuleSchema>) {
    return this.fees.createRule(body, me.id);
  }

  @Put('rules/:id')
  updateRule(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reminderRuleSchema)) body: z.infer<typeof reminderRuleSchema>) {
    return this.fees.updateRule(id, body, me.id);
  }

  @Delete('rules/:id')
  deleteRule(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.fees.deleteRule(id, me.id);
  }
}
