import request from 'supertest';
import { Ctx, bootstrap, buildSchool, phone } from '../helpers';

describe('authentication and security (NFR-10..14)', () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await bootstrap();
  });
  afterAll(() => ctx.close());

  it('requires a session on every route except the webhook and health', async () => {
    const http = request(ctx.app.getHttpServer());
    const r = await http.get('/api/v1/students');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHENTICATED');
    await http.get('/api/v1/health').expect(200);
  });

  it('requires X-Requested-With on state-changing requests (CSRF)', async () => {
    const cookie = (await ctx.agent.get('/api/v1/auth/me')).request.cookies;
    const r = await request(ctx.app.getHttpServer()).post('/api/v1/departments').set('Cookie', cookie).send({ name: 'X' });
    expect(r.status).toBe(403);
  });

  it('locks login for 15 minutes after 5 failed attempts', async () => {
    const http = request(ctx.app.getHttpServer());
    for (let i = 0; i < 5; i++) {
      await http.post('/api/v1/auth/login').set('X-Requested-With', 'x').send({ email: 'admin@test.cm', password: 'wrong' }).expect(401);
    }
    const locked = await http.post('/api/v1/auth/login').set('X-Requested-With', 'x').send({ email: 'admin@test.cm', password: 'Password123!' });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(await ctx.redis.ttl('login:fail:admin@test.cm')).toBeGreaterThan(14 * 60);
  });

  it('stores passwords with bcrypt cost 12 and phone numbers encrypted', async () => {
    const admin = await ctx.prisma.adminUser.findFirstOrThrow();
    expect(admin.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    await buildSchool(ctx, [['S1', '6e A', []]]);
    const s = await ctx.prisma.student.findFirstOrThrow();
    await ctx.agent.post(`/api/v1/students/${s.id}/contacts`).send({ name: 'Mme S', phone: '671234565' }).expect(201);
    const c = await ctx.prisma.parentContact.findFirstOrThrow();
    expect(c.phoneE164).toMatch(/^v1:/);
    expect(c.phoneE164).not.toContain('671234565');
    expect(ctx.crypto.decrypt(c.phoneE164)).toBe('+237671234565');
    const bad = await ctx.agent.post(`/api/v1/students/${s.id}/contacts`).send({ name: 'X', phone: '12345' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_PHONE');
  });

  it('never returns Meta secrets', async () => {
    await ctx.agent.put('/api/v1/settings').send({ wa_access_token: 'EAAG-secret', wa_app_secret: 'app-secret' }).expect(200);
    const s = await ctx.agent.get('/api/v1/settings');
    expect(JSON.stringify(s.body)).not.toContain('EAAG-secret');
    expect(s.body.wa_access_token_set).toBe(true);
    const row = await ctx.prisma.setting.findUniqueOrThrow({ where: { key: 'wa_access_token' } });
    expect(row.value).not.toContain('EAAG');
  });

  it('records actions in the audit log (NFR-15) and erases personal data on request (NFR-14)', async () => {
    const s = await ctx.prisma.student.findFirstOrThrow();
    await ctx.agent.post(`/api/v1/students/${s.id}/erase`).expect(201);
    const erased = await ctx.prisma.student.findUniqueOrThrow({ where: { id: s.id }, include: { contacts: true } });
    expect(erased.firstName).toBe('Effacé');
    expect(erased.contacts.every((c) => c.isOptedOut && c.name === 'Effacé')).toBe(true);
    const actions = (await ctx.prisma.auditLog.findMany()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['LOGIN', 'CREATE', 'UPDATE', 'ERASE_PERSONAL_DATA']));
  });

  it('never messages opted-out contacts', async () => {
    const s = await ctx.prisma.student.create({ data: { matricule: 'OPT', firstName: 'A', lastName: 'B' } });
    const cls = await ctx.prisma.class.findFirstOrThrow();
    const year = await ctx.prisma.academicYear.findFirstOrThrow();
    await ctx.prisma.enrolment.create({ data: { studentId: s.id, classId: cls.id, academicYearId: year.id } });
    await ctx.agent.post(`/api/v1/students/${s.id}/contacts`).send({ name: 'P1', phone: phone() }).expect(201);
    await ctx.agent.post(`/api/v1/students/${s.id}/contacts`).send({ name: 'P2', phone: phone(), isOptedOut: true }).expect(201);
    const tpl = await ctx.prisma.messageTemplate.findFirstOrThrow({ where: { metaName: 'annonce_generale' } });
    const p = await ctx.agent.post('/api/v1/dispatches/preview').send({ template_id: tpl.id, parameters: {}, recipients_filter: { student_ids: [s.id] } });
    expect(p.body.messages).toBe(1);
  });
});
