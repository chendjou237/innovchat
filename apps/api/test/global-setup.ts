import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import './setup-env';

/** Creates the test database if needed and applies migrations (non-destructive). */
export default async function globalSetup() {
  const url = new URL(process.env.DATABASE_URL!);
  const dbName = url.pathname.slice(1);
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to run tests against a non-test database: ${dbName}`);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const prisma = new PrismaClient({ datasources: { db: { url: admin.toString() } } });
  const exists = await prisma.$queryRaw<unknown[]>`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
  if (exists.length === 0) await prisma.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  await prisma.$disconnect();
  execSync('npx prisma migrate deploy', { cwd: __dirname + '/..', env: { ...process.env }, stdio: 'pipe' });
}
