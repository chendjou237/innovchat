import { createHmac } from 'node:crypto';
import request from 'supertest';
import { MockWhatsAppProvider } from '../../src/whatsapp/mock.provider';
import { Ctx, School, bootstrap, buildSchool, phone, templateId } from '../helpers';

describe('webhook (§6.3) and no-double-send guarantees (NFR-07/08)', () => {
  let ctx: Ctx;
  let school: School;
  let dispatchId: string;

  beforeAll(async () => {
    ctx = await bootstrap();
    school = await buildSchool(ctx, [
      ['W1', '6e A', [phone(), phone()]],
      ['W2', '5e B', [phone()]],
    ]);
    const res = await ctx.agent
      .post('/api/v1/dispatches')
      .send({ template_id: await templateId(ctx, 'annonce_generale'), parameters: { message: 'x' }, recipients_filter: { whole_school: true } });
    dispatchId = res.body.id;
  });
  afterAll(() => ctx.close());

  const statusBody = (wamid: string, status: string) =>
    JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: wamid, status, timestamp: '1791187200' }] } }] }] });
  const sign = (body: string, secret = 'test-app-secret') => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

  it('answers the verification challenge only with the right token', async () => {
    const http = request(ctx.app.getHttpServer());
    const ok = await http.get('/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=4242');
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('4242');
    const bad = await http.get('/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=4242');
    expect(bad.status).toBe(403);
  });

  it('processing a dispatch twice never duplicates messages', async () => {
    await ctx.delivery.processDispatch(dispatchId);
    await ctx.prisma.dispatch.update({ where: { id: dispatchId }, data: { materializedAt: null } }); // simulate a crash before the flag was saved
    await ctx.delivery.processDispatch(dispatchId);
    expect(await ctx.prisma.message.count({ where: { dispatchId } })).toBe(3);
  });

  it('concurrent sends of the same message call WhatsApp once', async () => {
    const msgs = await ctx.prisma.message.findMany({ where: { dispatchId } });
    MockWhatsAppProvider.sent.length = 0;
    const results = await Promise.all(msgs.flatMap((m) => [ctx.delivery.sendMessage(m.id), ctx.delivery.sendMessage(m.id), ctx.delivery.sendMessage(m.id)]));
    expect(results.filter((r) => r === 'sent')).toHaveLength(3);
    expect(MockWhatsAppProvider.sent).toHaveLength(3);
    // After a "restart", the recovery sweep re-queues nothing that was already sent.
    expect((await ctx.delivery.recover(new Date(Date.now() + 10 * 60_000))).messages).toBe(0);
  });

  it('rejects unsigned or badly signed events', async () => {
    const http = request(ctx.app.getHttpServer());
    const body = statusBody('x', 'sent');
    await http.post('/api/v1/webhooks/whatsapp').set('Content-Type', 'application/json').send(body).expect(401);
    await http.post('/api/v1/webhooks/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign(body, 'wrong')).send(body).expect(401);
    expect(await ctx.prisma.webhookEvent.count()).toBe(0);
  });

  it('stores signed events, answers 200 and applies them forward-only and idempotently', async () => {
    const http = request(ctx.app.getHttpServer());
    const m = await ctx.prisma.message.findFirstOrThrow({ where: { dispatchId, wamid: { not: null } } });
    for (const status of ['sent', 'read', 'delivered', 'sent', 'read']) {
      const body = statusBody(m.wamid!, status);
      await http.post('/api/v1/webhooks/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign(body)).send(body).expect(200);
    }
    const events = await ctx.prisma.webhookEvent.findMany({ orderBy: { createdAt: 'asc' } });
    expect(events).toHaveLength(5);
    for (const e of events) await ctx.delivery.processWebhook(e.id);
    const after = await ctx.prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.status).toBe('READ');
    expect(after.sentAt).not.toBeNull();
    expect(after.readAt!.toISOString()).toBe('2026-10-05T08:00:00.000Z'); // event timestamp 1791187200
    expect((await ctx.prisma.webhookEvent.findMany()).every((e) => e.processedAt)).toBe(true);
  });

  it('honours the daily messaging limit by deferring to the next morning', async () => {
    await ctx.agent.put('/api/v1/settings').send({ wa_daily_limit: 1 }).expect(200);
    const res = await ctx.agent
      .post('/api/v1/dispatches')
      .send({ template_id: await templateId(ctx, 'annonce_generale'), parameters: { message: 'y' }, recipients_filter: { whole_school: true } });
    await ctx.delivery.processDispatch(res.body.id);
    const msgs = await ctx.prisma.message.findMany({ where: { dispatchId: res.body.id } });
    const results = [];
    for (const m of msgs) results.push(await ctx.delivery.sendMessage(m.id));
    expect(results).toEqual(['deferred', 'deferred', 'deferred']); // the earlier test already used today's quota
    const deferred = await ctx.prisma.message.findFirstOrThrow({ where: { dispatchId: res.body.id } });
    expect(deferred.status).toBe('QUEUED');
    expect(deferred.attemptCount).toBe(0);
    expect(deferred.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    await ctx.agent.put('/api/v1/settings').send({ wa_daily_limit: 250 }).expect(200);
  });
});
