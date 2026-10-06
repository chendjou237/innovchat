import { Ctx, School, bootstrap, buildSchool, phone, runDispatch } from '../helpers';

// UC-01 Record absences and confirm alerts.
describe('UC-01 attendance → draft alerts → confirmation', () => {
  let ctx: Ctx;
  let school: School;

  beforeAll(async () => {
    ctx = await bootstrap();
    school = await buildSchool(ctx, [
      ['A1', '6e A', [phone(), phone()]], // two parents
      ['A2', '6e A', [phone()]],
      ['A3', '6e A', [phone()]],
      ['A4', '6e A', []], // no contact
    ]);
  });
  afterAll(() => ctx.close());

  it('records three absences as draft alerts, then confirms two and discards one', async () => {
    const ids = ['A1', 'A2', 'A3'].map((m) => school.students[m].id);
    const rec = await ctx.agent
      .post('/api/v1/attendance/anomalies')
      .send({ type: 'ABSENCE', date: '2026-10-05', subject_id: school.subjectId, time_slot: '08:00-10:00', student_ids: ids, note: null });
    expect(rec.status).toBe(201);
    expect(rec.body).toHaveLength(3);
    expect(rec.body.every((a: { alert_status: string }) => a.alert_status === 'AWAITING_CONFIRMATION')).toBe(true);

    // Nothing is sent yet.
    expect(await ctx.prisma.message.count()).toBe(0);

    const bell = await ctx.agent.get('/api/v1/notifications');
    expect(bell.body.items.map((n: { title: string }) => n.title)).toContain('3 alertes en attente de confirmation');

    const pending = await ctx.agent.get('/api/v1/alerts/pending');
    expect(pending.body).toHaveLength(3);
    const a1 = pending.body.find((p: { student: { id: string } }) => p.student.id === school.students.A1.id);
    expect(a1.previews).toHaveLength(2);
    expect(a1.previews[0]).toContain('a été absent(e) le 05/10/2026 au cours de Mathématiques (créneau : 08:00-10:00)');

    const discardId = pending.body.find((p: { student: { id: string } }) => p.student.id === school.students.A3.id).id;
    const keep = pending.body.filter((p: { id: string }) => p.id !== discardId).map((p: { id: string }) => p.id);

    const discard = await ctx.agent.post('/api/v1/alerts/discard').send({ alert_ids: [discardId], reason: "L'élève était arrivé" });
    expect(discard.body).toEqual({ discarded: 1 });
    const confirm = await ctx.agent.post('/api/v1/alerts/confirm').send({ alert_ids: keep });
    expect(confirm.body.confirmed).toBe(2);

    for (const id of keep) await runDispatch(ctx, id);
    // One message per registered contact: A1 has 2, A2 has 1.
    expect(await ctx.prisma.message.count()).toBe(3);
    const discarded = await ctx.prisma.dispatch.findUniqueOrThrow({ where: { id: discardId } });
    expect(discarded.status).toBe('CANCELLED');
    expect(discarded.cancelReason).toBe("L'élève était arrivé");
    const log = await ctx.prisma.auditLog.findFirst({ where: { action: 'DISCARD', entityId: discardId } });
    expect(log).not.toBeNull();

    const bellAfter = await ctx.agent.get('/api/v1/notifications');
    expect(bellAfter.body.items.find((n: { type: string }) => n.type === 'AWAITING_CONFIRMATION')).toBeUndefined();
  });

  it('flags an alert with no contact and refuses to confirm it', async () => {
    await ctx.agent
      .post('/api/v1/attendance/anomalies')
      .send({ type: 'TARDINESS', date: '2026-10-05', arrival_time: '08:20', student_ids: [school.students.A4.id] })
      .expect(201);
    const pending = await ctx.agent.get('/api/v1/alerts/pending');
    const alert = pending.body.find((p: { student: { id: string } }) => p.student.id === school.students.A4.id);
    expect(alert.has_contact).toBe(false);
    const confirm = await ctx.agent.post('/api/v1/alerts/confirm').send({ alert_ids: [alert.id] });
    expect(confirm.body.confirmed).toBe(0);
    expect(confirm.body.skipped[0].reason).toBe('NO_CONTACT');
  });

  it('allows editing only while awaiting confirmation, then only justification', async () => {
    const sent = await ctx.prisma.attendanceAnomaly.findFirstOrThrow({ where: { enrolmentId: school.students.A1.enrolmentId } });
    const edit = await ctx.agent.patch(`/api/v1/attendance/anomalies/${sent.id}`).send({ note: 'x' });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('ALERT_ALREADY_SENT');
    const del = await ctx.agent.delete(`/api/v1/attendance/anomalies/${sent.id}`);
    expect(del.status).toBe(409);
    const justify = await ctx.agent.post(`/api/v1/attendance/anomalies/${sent.id}/justify`).send({ note: 'Certificat médical' });
    expect(justify.status).toBe(200);
    expect(justify.body.isJustified).toBe(true);

    const draft = await ctx.prisma.attendanceAnomaly.findFirstOrThrow({ where: { enrolmentId: school.students.A4.enrolmentId } });
    await ctx.agent.patch(`/api/v1/attendance/anomalies/${draft.id}`).send({ arrival_time: '08:30' }).expect(200);
    await ctx.agent.delete(`/api/v1/attendance/anomalies/${draft.id}`).expect(200);
  });

  it('lists history per class and exports it to Excel', async () => {
    const hist = await ctx.agent.get(`/api/v1/attendance/anomalies?class_id=${school.classes['6e A']}&type=ABSENCE`);
    expect(hist.body).toHaveLength(3);
    const xlsx = await ctx.agent.get(`/api/v1/attendance/anomalies/export?class_id=${school.classes['6e A']}`);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
  });
});
