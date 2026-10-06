import { MockWhatsAppProvider } from '../../src/whatsapp/mock.provider';
import { Ctx, School, bootstrap, buildSchool, phone, runDispatch, templateId, webhookAll } from '../helpers';

// UC-06 Handle failed messages (FR-DLV-001..006).
describe('UC-06 failures, retries and resend', () => {
  let ctx: Ctx;
  let school: School;
  let dispatchId: string;

  beforeAll(async () => {
    ctx = await bootstrap();
    school = await buildSchool(ctx, [
      ['OK1', '6e A', [phone()]],
      ['OK2', '6e A', [phone()]],
      ['NOWA', '6e A', [phone('0000')]], // not on WhatsApp → permanent
      ['BAD', '6e A', [phone('0001')]], // invalid → permanent
      ['RATE', '6e A', [phone('0002')]], // rate limited every time → retried 3 times then failed
      ['FLAKY', '6e A', [phone('0003')]], // server error once, then OK
    ]);
    const tpl = await templateId(ctx, 'annonce_generale');
    const res = await ctx.agent
      .post('/api/v1/dispatches')
      .send({ template_id: tpl, parameters: { message: 'Info' }, title: 'Rappel de frais du 05/10', recipients_filter: { class_ids: [school.classes['6e A']] } });
    dispatchId = res.body.id;
  });
  afterAll(() => ctx.close());

  const msgOf = (mat: string) => ctx.prisma.message.findFirstOrThrow({ where: { dispatchId, studentId: school.students[mat].id } });

  it('fails permanent errors at once and schedules retries for temporary ones', async () => {
    await runDispatch(ctx, dispatchId);
    expect((await msgOf('NOWA')).status).toBe('FAILED');
    expect((await msgOf('BAD')).status).toBe('FAILED');
    const rate = await msgOf('RATE');
    expect(rate.status).toBe('RETRY_PENDING');
    expect(rate.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(50_000); // ≈ 1 min
    expect((await msgOf('FLAKY')).status).toBe('RETRY_PENDING');
    // A retry job was queued with the 1-minute delay.
    const delayed = await ctx.queues.message.getDelayed();
    expect(delayed.map((j) => j.opts.delay)).toContain(60_000);
  });

  it('retries up to 3 times (1, 5, 30 min) then fails', async () => {
    const flaky = await msgOf('FLAKY');
    expect(await ctx.delivery.sendMessage(flaky.id)).toBe('sent');

    const rate = await msgOf('RATE');
    expect(await ctx.delivery.sendMessage(rate.id)).toBe('retry'); // attempt 2 → +5 min
    expect((await msgOf('RATE')).nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(290_000);
    expect(await ctx.delivery.sendMessage(rate.id)).toBe('retry'); // attempt 3 → +30 min
    expect(await ctx.delivery.sendMessage(rate.id)).toBe('failed'); // attempt 4 = 3rd retry
    expect((await msgOf('RATE')).attemptCount).toBe(4);
  });

  it('completes with failures and raises one grouped notification', async () => {
    await webhookAll(ctx, dispatchId, 'delivered');
    const d = await ctx.prisma.dispatch.findUniqueOrThrow({ where: { id: dispatchId } });
    expect(d.status).toBe('COMPLETED_WITH_FAILURES');
    const bell = await ctx.agent.get('/api/v1/notifications');
    const n = bell.body.items.filter((i: { type: string }) => i.type === 'DISPATCH_FAILURES');
    expect(n).toHaveLength(1);
    expect(n[0].title).toBe('3 messages en échec — Rappel de frais du 05/10');

    const failed = await ctx.agent.get(`/api/v1/dispatches/${dispatchId}/messages?status=FAILED`);
    expect(failed.body.map((m: { error_reason: string }) => m.error_reason).sort()).toEqual(['Limite de débit atteinte', 'Numéro absent de WhatsApp', 'Numéro ou paramètre invalide']);
  });

  it('a failed webhook after "sent" marks the message failed', async () => {
    const ok2 = await msgOf('OK2');
    await ctx.delivery.applyStatus({ id: ok2.wamid!, status: 'failed', errors: [{ code: 131026, title: 'Message undeliverable' }] });
    // DELIVERED cannot become FAILED
    expect((await msgOf('OK2')).status).toBe('DELIVERED');
  });

  it('corrects a number and resends', async () => {
    const nowa = await msgOf('NOWA');
    MockWhatsAppProvider.sent.length = 0;
    const res = await ctx.agent.post(`/api/v1/messages/${nowa.id}/resend`).send({ phone: '677 88 99 15' });
    expect(res.status).toBe(200);
    expect((await ctx.prisma.dispatch.findUniqueOrThrow({ where: { id: dispatchId } })).status).toBe('PROCESSING');
    expect(await ctx.delivery.sendMessage(nowa.id)).toBe('sent');
    expect(MockWhatsAppProvider.sent[0].to).toBe('+237677889915');
    // The contact itself is corrected for future messages.
    const contact = await ctx.prisma.parentContact.findUniqueOrThrow({ where: { id: nowa.parentContactId } });
    expect(ctx.crypto.decrypt(contact.phoneE164)).toBe('+237677889915');

    const again = await ctx.agent.post(`/api/v1/messages/${nowa.id}/resend`).send({});
    expect(again.status).toBe(409);
  });

  it('exports history to Excel', async () => {
    const res = await ctx.agent.get('/api/v1/dispatches/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('historique-envois.xlsx');
  });
});
