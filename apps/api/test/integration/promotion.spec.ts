import { Ctx, School, bootstrap, buildSchool, phone } from '../helpers';

// Year-end promotion (FR-PRO-001..005).
describe('year-end promotion', () => {
  let ctx: Ctx;
  let school: School;

  beforeAll(async () => {
    ctx = await bootstrap();
    school = await buildSchool(ctx, [
      ['P1', '6e A', [phone()]],
      ['P2', '6e A', [phone()]],
      ['P3', '5e B', [phone()]],
      ['P4', '3e C', [phone()]],
    ]);
    await ctx.agent
      .post('/api/v1/attendance/anomalies')
      .send({ type: 'TARDINESS', date: '2026-10-05', arrival_time: '08:10', student_ids: [school.students.P1.id] })
      .expect(201);
  });
  afterAll(() => ctx.close());

  it('maps classes, applies outcomes, switches the active year and keeps history', async () => {
    const body = {
      next_year: { label: '2027-2028', startDate: '2027-09-06', endDate: '2028-06-30' },
      class_map: { [school.classes['6e A']]: '5e B', [school.classes['5e B']]: '3e C', [school.classes['3e C']]: null },
      outcomes: { [school.students.P2.id]: 'REPEATING' },
    };
    const preview = await ctx.agent.post('/api/v1/promotions/preview').send(body);
    expect(preview.body.summary).toEqual({ next_classes: { '5e B': { promoted: 1, repeating: 0 }, '6e A': { promoted: 0, repeating: 1 }, '3e C': { promoted: 1, repeating: 0 } }, leaving: 1, unmapped: [] });

    const res = await ctx.agent.post('/api/v1/promotions/commit').send(body);
    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ PROMOTED: 2, REPEATING: 1, LEFT: 1 });

    const years = await ctx.agent.get('/api/v1/academic-years');
    expect(years.body.find((y: { isActive: boolean }) => y.isActive).label).toBe('2027-2028');
    const classes = await ctx.agent.get('/api/v1/classes');
    expect(classes.body.map((c: { name: string }) => c.name).sort()).toEqual(['3e C', '5e B', '6e A']);

    const p1 = await ctx.agent.get(`/api/v1/students/${school.students.P1.id}`);
    expect(p1.body.enrolments.map((e: { class: { name: string }; outcome: string | null }) => [e.class.name, e.outcome])).toEqual([
      ['5e B', null],
      ['6e A', 'PROMOTED'],
    ]);
    expect(p1.body.anomalies).toHaveLength(1); // history stays attached to the previous enrolment
    const p4 = await ctx.prisma.student.findUniqueOrThrow({ where: { id: school.students.P4.id } });
    expect(p4.status).toBe('LEFT');
    expect(await ctx.prisma.auditLog.count({ where: { action: 'PROMOTION' } })).toBe(1);
  });
});
