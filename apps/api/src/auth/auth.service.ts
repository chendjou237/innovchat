import { Inject, Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import type { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../core/audit.service';
import { AppError } from '../core/errors';
import { PrismaService } from '../core/prisma.service';
import { REDIS } from '../core/redis';

export const SESSION_COOKIE = 'sid';
export const SESSION_TTL_S = 8 * 3600; // expires after 8 h of inactivity (NFR-10)
const LOCK_ATTEMPTS = 5; // NFR-11
const LOCK_TTL_S = 15 * 60;
export const BCRYPT_COST = 12;

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly audit: AuditService,
  ) {}

  static hash(password: string) {
    return bcrypt.hash(password, BCRYPT_COST);
  }

  async login(email: string, password: string): Promise<{ token: string; user: SessionUser }> {
    const lockKey = `login:fail:${email}`;
    const failures = Number((await this.redis.get(lockKey)) ?? 0);
    if (failures >= LOCK_ATTEMPTS) {
      const ttl = await this.redis.ttl(lockKey);
      throw new AppError(429, 'ACCOUNT_LOCKED', `Trop de tentatives. Réessayez dans ${Math.ceil(Math.max(ttl, 60) / 60)} minutes.`);
    }

    const user = await this.prisma.adminUser.findUnique({ where: { email } });
    const ok = user && user.isActive && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) {
      const n = await this.redis.incr(lockKey);
      if (n === 1 || n >= LOCK_ATTEMPTS) await this.redis.expire(lockKey, LOCK_TTL_S);
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Adresse e-mail ou mot de passe incorrect.');
    }

    await this.redis.del(lockKey);
    const token = randomBytes(32).toString('base64url');
    const sessionUser: SessionUser = { id: user.id, email: user.email, fullName: user.fullName, role: user.role };
    await this.redis.set(`sess:${token}`, JSON.stringify(sessionUser), 'EX', SESSION_TTL_S);
    await this.redis.sadd(`user-sess:${user.id}`, token);
    await this.prisma.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log(user.id, 'LOGIN', 'admin_user', user.id);
    return { token, user: sessionUser };
  }

  /** Returns the session's user and slides its expiry. */
  async resolve(token: string | undefined): Promise<SessionUser | null> {
    if (!token) return null;
    const key = `sess:${token}`;
    const raw = await this.redis.get(key);
    if (!raw) return null;
    await this.redis.expire(key, SESSION_TTL_S);
    return JSON.parse(raw) as SessionUser;
  }

  async logout(token: string | undefined) {
    if (token) await this.redis.del(`sess:${token}`);
  }

  /** Ends every session of a user (deactivation, password reset). */
  async revokeAll(userId: string) {
    const tokens = await this.redis.smembers(`user-sess:${userId}`);
    if (tokens.length) await this.redis.del(...tokens.map((t) => `sess:${t}`));
    await this.redis.del(`user-sess:${userId}`);
  }
}
