import { MockWhatsAppProvider } from '../../src/whatsapp/mock.provider';
import { Ctx, School, bootstrap, buildSchool, phone, runDispatch } from '../helpers';

// UC-03 Fee reminder for unpaid balances (FR-FEE-001..007).
describe('UC-03 fees and reminders', () => {
  let ctx: Ctx;
  let school: School;
  let instId: string;

  beforeAll(async () => {
    ctx = await bootstrap();
    school = await buildSchool(ctx, [
      ['F1', '6e A', [phone()]],
      ['F2', '6e A', [phone()]],
      ['F3', '5e B', [phone()]],
      ['F4', '3e C', [phone()]],
    ]);
  });
  afterAll(() => ctx.close());

  it('defines an installment with a per-class amount and computes balances', async () => {
    const res = await ctx.agent
      .post('/api/v1/fees/installments')
      .send({ name: '1ère tranche', due_date: '2026-10-15', default_amount_xaf: 75000, class_amounts: { [school.classes['3e C']]: 90000 } });
    expect(res.status).toBe(201);
    instId = res.body.id;

    // F1 paid in full, F2 paid half, F3 has a scholarship override, F4 owes the class amount.
    await ctx.agent.post('/api/v1/fees/payments').send({ student_id: school.students.F1.id, installment_id: instId, amount_xaf: 75000, paid_on: '2026-10-01', reference: 'R1' }).expect(201);
    await ctx.agent.post('/api/v1/fees/payments').send({ student_id: school.students.F2.id, installment_id: instId, amount_xaf: 25000, paid_on: '2026-10-02', reference: 'R2' }).expect(201);
    await ctx.agent.put('/api/v1/fees/students').send({ student_id: school.students.F3.id, installment_id: instId, amount_due_xaf: 0 }).expect(200);

    const unpaid = await ctx.agent.get(`/api/v1/fees/students?installment_id=${instId}&unpaid=true`);
    const byMat = Object.fromEntries(unpaid.body.map((r: { student: { matricule: string }; balance: number }) => [r.student.matricule, r.balance]));
    expect(byMat).toEqual({ F2: 50000, F4: 90000 });
  });

  it('reminds only unpaid students, each with their own amount', async () => {
    const preview = await ctx.agent.post('/api/v1/fees/reminders').send({ installment_id: instId, recipients_filter: { whole_school: true }, preview_only: true });
    expect(preview.body.students).toBe(2);
    expect(preview.body.messages).toBe(2);

    const created = await ctx.agent.post('/api/v1/fees/reminders').send({ installment_id: instId, recipients_filter: { whole_school: true } });
    expect(created.body.status).toBe('PROCESSING');
    MockWhatsAppProvider.sent.length = 0;
    await runDispatch(ctx, created.body.id);
    const amounts = MockWhatsAppProvider.sent.map((s) => s.params[4]).sort();
    expect(amounts).toEqual(['50 000', '90 000']);
    expect(MockWhatsAppProvider.sent[0].params[1]).toBe('1ère tranche');
    expect(MockWhatsAppProvider.sent[0].params[5]).toBe('15/10/2026');
  });

  it('re-reads balances at send time: a student who paid in between is skipped', async () => {
    const friday = new Date(Date.now() + 2 * 86400000).toISOString();
    const res = await ctx.agent.post('/api/v1/fees/reminders').send({ installment_id: instId, recipients_filter: { whole_school: true }, scheduled_for: friday });
    expect(res.body.status).toBe('SCHEDULED');
    expect(res.body.students).toBe(2);

    // Thursday: F2 pays the rest.
    await ctx.agent.post('/api/v1/fees/payments').send({ student_id: school.students.F2.id, installment_id: instId, amount_xaf: 50000, paid_on: '2026-10-08', reference: 'R3' }).expect(201);

    await ctx.prisma.dispatch.update({ where: { id: res.body.id }, data: { scheduledFor: new Date(Date.now() - 1000) } });
    await ctx.delivery.startDueDispatches();
    MockWhatsAppProvider.sent.length = 0;
    await runDispatch(ctx, res.body.id);
    expect(MockWhatsAppProvider.sent.map((s) => s.params[2])).toEqual(['PrénomF4 NOMF4']);
  });

  it('automatic reminder rules are off by default and schedule a dispatch when enabled', async () => {
    const future = await ctx.agent.post('/api/v1/fees/installments').send({ name: '2e tranche', due_date: '2027-01-15', default_amount_xaf: 60000 });
    const off = await ctx.agent.post('/api/v1/fees/rules').send({ installment_id: future.body.id, days_offset: -7, send_time: '08:00', recipient_filter: { whole_school: true } });
    expect(off.body.isEnabled).toBe(false);
    expect(off.body.dispatch).toBeNull();

    const on = await ctx.agent.put(`/api/v1/fees/rules/${off.body.id}`).send({ installment_id: future.body.id, days_offset: -7, send_time: '08:00', recipient_filter: { whole_school: true }, is_enabled: true });
    expect(on.body.dispatch.status).toBe('SCHEDULED');
    expect(new Date(on.body.dispatch.scheduledFor).toISOString()).toBe('2027-01-08T07:00:00.000Z');

    // Moving the due date moves the reminder.
    await ctx.agent.put(`/api/v1/fees/installments/${future.body.id}`).send({ name: '2e tranche', due_date: '2027-01-22', default_amount_xaf: 60000, class_amounts: {} }).expect(200);
    const d = await ctx.prisma.dispatch.findUniqueOrThrow({ where: { id: on.body.dispatch.id } });
    expect(d.scheduledFor!.toISOString()).toBe('2027-01-15T07:00:00.000Z');
    expect(d.source).toBe('FEE_RULE');

    const disabled = await ctx.agent.put(`/api/v1/fees/rules/${off.body.id}`).send({ installment_id: future.body.id, days_offset: -7, send_time: '08:00', recipient_filter: { whole_school: true }, is_enabled: false });
    expect(disabled.body.dispatch.status).toBe('CANCELLED');
  });
});
