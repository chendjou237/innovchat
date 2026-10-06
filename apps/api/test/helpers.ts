import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { maskPhone } from '@innovcare/shared';
import { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CryptoService } from '../src/core/crypto.service';
import { PrismaService } from '../src/core/prisma.service';
import { QueueService } from '../src/core/queues';
import { REDIS } from '../src/core/redis';
import { DeliveryService } from '../src/delivery/delivery.service';
import { LedgerService } from '../src/fees/ledger.service';
import { configureHttp } from '../src/http';
import { seed } from '../src/seed';
import { MockWhatsAppProvider } from '../src/whatsapp/mock.provider';

export interface Ctx {
  app: INestApplication;
  agent: ReturnType<typeof request.agent>;
  prisma: PrismaService;
  delivery: DeliveryService;
  crypto: CryptoService;
  queues: QueueService;
  redis: Redis;
  close: () => Promise<void>;
}

/** Boots the full API (with an authenticated agent) on a clean database. */
export async function bootstrap(): Promise<Ctx> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  configureHttp(app);
  await app.init();

  const prisma = app.get(PrismaService);
  const redis = app.get<Redis>(REDIS);
  const queues = app.get(QueueService);
  await reset(prisma, redis, queues);
  await seed(prisma as unknown as PrismaClient, { sample: false });
  await prisma.messageTemplate.updateMany({ data: { metaStatus: 'APPROVED' } });
  MockWhatsAppProvider.sent.length = 0;

  const agent = request.agent(app.getHttpServer());
  agent.set('X-Requested-With', 'jest');
  const res = await agent.post('/api/v1/auth/login').send({ email: 'admin@test.cm', password: 'Password123!' });
  if (res.status !== 200) throw new Error('login failed: ' + JSON.stringify(res.body));

  return {
    app,
    agent,
    prisma,
    redis,
    queues,
    delivery: app.get(DeliveryService),
    crypto: app.get(CryptoService),
    close: () => app.close(),
  };
}

export async function reset(prisma: PrismaService, redis: Redis, queues: QueueService) {
  if (!process.env.DATABASE_URL?.includes('_test')) throw new Error('reset() only runs on a *_test database');
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
  await redis.flushdb();
  for (const q of [queues.dispatch, queues.message, queues.webhook, queues.maintenance]) await q.obliterate({ force: true });
}

let phoneSeq = 100000;
/** Unique valid Cameroonian number; pass a 4-digit tail to trigger a mock failure (0000, 0002…). */
export function phone(tail?: string): string {
  phoneSeq++;
  // Plain numbers end in 5 so they never match the mock's failure tails (0000–0004).
  return tail ? `+2376${String(phoneSeq).slice(-4)}${tail}` : `+23767${String(phoneSeq).padStart(6, '0')}5`;
}

export interface School {
  yearId: string;
  deptA: string;
  deptB: string;
  classes: Record<string, string>; // name → id
  students: Record<string, { id: string; enrolmentId: string; contactIds: string[] }>;
  subjectId: string;
}

/**
 * Builds a small school: departments A/B, classes 6e A, 5e B (A) and 3e C (B), students
 * given as [matricule, class, phones[]].
 */
export async function buildSchool(ctx: Ctx, students: [string, string, string[]][]): Promise<School> {
  const { prisma, crypto } = ctx;
  const year = await prisma.academicYear.create({ data: { label: '2026-2027', startDate: new Date('2026-09-07'), endDate: new Date('2027-06-30'), isActive: true } });
  const deptA = await prisma.department.create({ data: { name: 'Premier cycle' } });
  const deptB = await prisma.department.create({ data: { name: 'Second cycle' } });
  const classes: Record<string, string> = {};
  for (const [name, dept] of [['6e A', deptA.id], ['5e B', deptA.id], ['3e C', deptB.id]] as const) {
    classes[name] = (await prisma.class.create({ data: { name, departmentId: dept, academicYearId: year.id } })).id;
  }
  const subject = await prisma.subject.create({ data: { name: 'Mathématiques' } });
  const out: School['students'] = {};
  for (const [mat, cls, phones] of students) {
    const s = await prisma.student.create({ data: { matricule: mat, firstName: `Prénom${mat}`, lastName: `NOM${mat}` } });
    const e = await prisma.enrolment.create({ data: { studentId: s.id, classId: classes[cls], academicYearId: year.id } });
    const contactIds: string[] = [];
    for (const [i, p] of phones.entries()) {
      const c = await prisma.parentContact.create({
        data: { studentId: s.id, name: `Parent${i + 1} ${mat}`, relationship: 'Mère', phoneE164: crypto.encrypt(p), phoneHash: crypto.phoneHash(p), phoneMasked: maskPhone(p), consentAt: new Date() },
      });
      contactIds.push(c.id);
    }
    out[mat] = { id: s.id, enrolmentId: e.id, contactIds };
  }
  await ctx.app.get(LedgerService).syncEnrolments(Object.values(out).map((s) => s.enrolmentId));
  return { yearId: year.id, deptA: deptA.id, deptB: deptB.id, classes, students: out, subjectId: subject.id };
}

export async function templateId(ctx: Ctx, metaName: string) {
  return (await ctx.prisma.messageTemplate.findFirstOrThrow({ where: { metaName } })).id;
}

/** Runs what the worker would do for a dispatch: materialise, send every message, finalize. */
export async function runDispatch(ctx: Ctx, dispatchId: string) {
  await ctx.delivery.processDispatch(dispatchId);
  const msgs = await ctx.prisma.message.findMany({ where: { dispatchId, status: { in: ['QUEUED', 'RETRY_PENDING'] }, wamid: null } });
  for (const m of msgs) await ctx.delivery.sendMessage(m.id);
}

/** Simulates Meta status webhooks for every accepted message of a dispatch. */
export async function webhookAll(ctx: Ctx, dispatchId: string, status: 'sent' | 'delivered' | 'read') {
  const msgs = await ctx.prisma.message.findMany({ where: { dispatchId, wamid: { not: null } } });
  for (const m of msgs) await ctx.delivery.applyStatus({ id: m.wamid!, status });
  await ctx.delivery.finalize(dispatchId);
}
