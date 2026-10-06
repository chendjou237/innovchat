import { MockWhatsAppProvider } from '../../src/whatsapp/mock.provider';
import { Ctx, School, bootstrap, buildSchool, phone, runDispatch } from '../helpers';

// UC-04 Calendar event with automatic triggers (FR-CAL-001..006).
describe('UC-04 calendar triggers', () => {
  let ctx: Ctx;
  let school: School;
  let eventId: string;
  const body = (start: string) => ({
    title: 'Réunion des parents',
    type: 'MEETING',
    start_date: start,
    end_date: start,
    start_time: '10:00',
    place: 'Salle polyvalente',
    description: null,
    recipient_filter: { department_ids: [school.deptA] },
    triggers: [
      { days_offset: -7, send_time: '08:00' },
      { days_offset: 0, send_time: '07:00' },
    ],
  });

  beforeAll(async () => {
    ctx = await bootstrap();
    school = await buildSchool(ctx, [
      ['C1', '6e A', [phone()]],
      ['C2', '5e B', [phone()]],
      ['C3', '3e C', [phone()]],
    ]);
  });
  afterAll(() => ctx.close());

  it('creates two scheduled dispatches, one per trigger', async () => {
    const res = await ctx.agent.post('/api/v1/calendar/events').send(body('2026-11-14'));
    expect(res.status).toBe(201);
    eventId = res.body.id;
    const times = res.body.triggers.map((t: { dispatch: { scheduledFor: string; status: string } }) => [t.dispatch.status, t.dispatch.scheduledFor]);
    expect(times).toEqual([
      ['SCHEDULED', '2026-11-07T07:00:00.000Z'],
      ['SCHEDULED', '2026-11-14T06:00:00.000Z'],
    ]);
    const scheduled = await ctx.agent.get('/api/v1/dispatches/scheduled');
    expect(scheduled.body.filter((d: { source: string }) => d.source === 'CALENDAR')).toHaveLength(2);
    expect(scheduled.body[0].messagesCount).toBe(2); // department A: C1 + C2
  });

  it('moving the event moves both dispatches', async () => {
    const res = await ctx.agent.put(`/api/v1/calendar/events/${eventId}`).send(body('2026-11-21'));
    expect(res.status).toBe(200);
    const times = res.body.triggers.map((t: { dispatch: { scheduledFor: string } }) => t.dispatch.scheduledFor);
    expect(times).toEqual(['2026-11-14T07:00:00.000Z', '2026-11-21T06:00:00.000Z']);
    expect(await ctx.prisma.dispatch.count({ where: { source: 'CALENDAR' } })).toBe(2);
  });

  it('reads event details at send time', async () => {
    const trig = await ctx.prisma.eventTrigger.findFirstOrThrow({ where: { eventId, daysOffset: -7 } });
    await ctx.prisma.calendarEvent.update({ where: { id: eventId }, data: { place: 'Grand préau' } });
    await ctx.prisma.dispatch.update({ where: { id: trig.dispatchId! }, data: { scheduledFor: new Date(Date.now() - 1000) } });
    await ctx.delivery.startDueDispatches();
    MockWhatsAppProvider.sent.length = 0;
    await runDispatch(ctx, trig.dispatchId!);
    expect(MockWhatsAppProvider.sent).toHaveLength(2);
    expect(MockWhatsAppProvider.sent[0].params[3]).toBe('samedi 21 novembre 2026');
    expect(MockWhatsAppProvider.sent[0].params[4]).toBe('10h00');
    expect(MockWhatsAppProvider.sent[0].params[5]).toBe('Grand préau');
  });

  it('deleting the event cancels pending dispatches but leaves sent ones', async () => {
    await ctx.agent.delete(`/api/v1/calendar/events/${eventId}`).expect(200);
    const statuses = (await ctx.prisma.dispatch.findMany({ where: { source: 'CALENDAR' }, orderBy: { scheduledFor: 'asc' } })).map((d) => d.status);
    expect(statuses.sort()).toEqual(['CANCELLED', 'PROCESSING']);
  });

  it('ignores duplicate triggers', async () => {
    const dup = { ...body('2026-12-05'), triggers: [{ days_offset: -1, send_time: '08:00' }, { days_offset: -1, send_time: '8:00' }] };
    const res = await ctx.agent.post('/api/v1/calendar/events').send(dup);
    expect(res.body.triggers).toHaveLength(1);
    await ctx.agent.delete(`/api/v1/calendar/events/${res.body.id}`).expect(200);
  });

  it('lists events overlapping a month', async () => {
    await ctx.agent.post('/api/v1/calendar/events').send({ ...body('2026-12-20'), end_date: '2027-01-04', type: 'HOLIDAY', triggers: [] }).expect(201);
    const jan = await ctx.agent.get('/api/v1/calendar/events?from=2027-01-01&to=2027-01-31');
    expect(jan.body).toHaveLength(1);
    expect(jan.body[0].start_date).toBe('2026-12-20');
  });
});
