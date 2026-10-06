import { MockWhatsAppProvider } from '../../src/whatsapp/mock.provider';
import { Ctx, School, bootstrap, buildSchool, phone, runDispatch, templateId, webhookAll } from '../helpers';

// UC-02 Cross-class dispatch, plus filter rules FR-FLT-001..008.
describe('UC-02 cross-class dispatch and recipient filter', () => {
  let ctx: Ctx;
  let school: School;
  let tpl: string;

  beforeAll(async () => {
    ctx = await bootstrap();
    school = await buildSchool(ctx, [
      ['X', '6e A', [phone(), phone()]],
      ['Y', '5e B', [phone(), phone()]],
      ['Z', '3e C', [phone()]],
      ['W', '6e A', [phone()]],
      ['NOC', '3e C', []],
    ]);
    tpl = await templateId(ctx, 'annonce_generale');
  });
  afterAll(() => ctx.close());

  const filter = (f: Record<string, unknown>) => ({ whole_school: false, department_ids: [], class_ids: [], student_ids: [], exclude_student_ids: [], fee_installment_unpaid: null, ...f });

  it('previews 3 students and 5 messages with cost', async () => {
    const ids = ['X', 'Y', 'Z'].map((m) => school.students[m].id);
    const res = await ctx.agent.post('/api/v1/dispatches/preview').send({ template_id: tpl, parameters: { message: 'Sortie' }, recipients_filter: filter({ student_ids: ids }) });
    expect(res.status).toBe(200);
    expect(res.body.students).toBe(3);
    expect(res.body.messages).toBe(5);
    expect(res.body.estimated_cost_xaf).toBe(5 * 45); // annonce_generale is MARKETING at 45 FCFA
    expect(res.body.sample_message).toContain('Sortie');
  });

  it('combines levels as a union, applies exclusions and lists students without contact', async () => {
    const res = await ctx.agent.post('/api/v1/dispatches/preview').send({
      template_id: tpl,
      parameters: { message: 'x' },
      recipients_filter: filter({ department_ids: [school.deptB], class_ids: [school.classes['6e A']], student_ids: [school.students.Y.id], exclude_student_ids: [school.students.W.id] }),
    });
    // dept B → Z, NOC; class 6e A → X, W(excluded); student Y
    expect(res.body.students).toBe(3);
    expect(res.body.messages).toBe(5);
    expect(res.body.students_without_contact.map((s: { name: string }) => s.name)).toEqual(['NOMNOC PrénomNOC']);

    const all = await ctx.agent.post('/api/v1/dispatches/preview').send({ template_id: tpl, parameters: {}, recipients_filter: filter({ whole_school: true }) });
    expect(all.body.students).toBe(4);
    expect(all.body.messages).toBe(6);
  });

  it('sends now, tracks statuses forward-only and completes', async () => {
    const ids = ['X', 'Y', 'Z'].map((m) => school.students[m].id);
    const res = await ctx.agent.post('/api/v1/dispatches').send({ template_id: tpl, parameters: { message: 'Sortie' }, recipients_filter: filter({ student_ids: ids }) });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PROCESSING');
    const id = res.body.id;

    await runDispatch(ctx, id);
    expect(MockWhatsAppProvider.sent).toHaveLength(5);
    expect(MockWhatsAppProvider.sent[0].params[3]).toBe('Sortie');

    await webhookAll(ctx, id, 'read');
    await webhookAll(ctx, id, 'sent'); // late "sent" must not overwrite "read"
    const msgs = await ctx.agent.get(`/api/v1/dispatches/${id}/messages`);
    expect(msgs.body.every((m: { status: string }) => m.status === 'READ')).toBe(true);
    expect(msgs.body[0]).not.toHaveProperty('phoneE164');

    const d = await ctx.agent.get(`/api/v1/dispatches/${id}`);
    expect(d.body.status).toBe('COMPLETED');
    expect(d.body.counts).toEqual({ READ: 5 });
  });

  it('refuses unapproved templates', async () => {
    await ctx.prisma.messageTemplate.update({ where: { id: tpl }, data: { metaStatus: 'PAUSED' } });
    const res = await ctx.agent.post('/api/v1/dispatches').send({ template_id: tpl, parameters: {}, recipients_filter: filter({ whole_school: true }) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TEMPLATE_NOT_APPROVED');
    await ctx.prisma.messageTemplate.update({ where: { id: tpl }, data: { metaStatus: 'APPROVED' } });
  });

  it('schedules, edits and cancels until processing starts (FR-SCH-001..005)', async () => {
    const at = new Date(Date.now() + 3600_000).toISOString();
    const res = await ctx.agent.post('/api/v1/dispatches').send({ template_id: tpl, parameters: { message: 'Plus tard' }, recipients_filter: filter({ class_ids: [school.classes['6e A']] }), scheduled_for: at });
    expect(res.body.status).toBe('SCHEDULED');
    const list = await ctx.agent.get('/api/v1/dispatches/scheduled');
    expect(list.body.map((d: { id: string }) => d.id)).toContain(res.body.id);

    const later = new Date(Date.now() + 7200_000).toISOString();
    const edit = await ctx.agent.patch(`/api/v1/dispatches/${res.body.id}`).send({ scheduled_for: later, recipients_filter: filter({ class_ids: [school.classes['5e B']] }) });
    expect(edit.status).toBe(200);
    expect(edit.body.messagesCount).toBe(2);

    // A student moving into the targeted class before send time is included (FR-SCH-002).
    await ctx.agent.patch(`/api/v1/students/${school.students.W.id}`).send({ classId: school.classes['5e B'] }).expect(200);
    await ctx.prisma.dispatch.update({ where: { id: res.body.id }, data: { scheduledFor: new Date(Date.now() - 1000) } });
    expect(await ctx.delivery.startDueDispatches()).toBe(1);
    // Locked once processing started.
    const late = await ctx.agent.post(`/api/v1/dispatches/${res.body.id}/cancel`);
    expect(late.status).toBe(409);
    await ctx.delivery.processDispatch(res.body.id);
    const msgs = await ctx.prisma.message.findMany({ where: { dispatchId: res.body.id } });
    expect(new Set(msgs.map((m) => m.studentId))).toEqual(new Set([school.students.Y.id, school.students.W.id]));

    const other = await ctx.agent.post('/api/v1/dispatches').send({ template_id: tpl, parameters: {}, recipients_filter: filter({ whole_school: true }), scheduled_for: at });
    await ctx.agent.post(`/api/v1/dispatches/${other.body.id}/cancel`).expect(200);
    expect((await ctx.prisma.dispatch.findUniqueOrThrow({ where: { id: other.body.id } })).status).toBe('CANCELLED');
  });
});
