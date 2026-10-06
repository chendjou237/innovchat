import { CanActivate, ExecutionContext, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../core/errors';
import { AuthService, SESSION_COOKIE, SessionUser } from './auth.service';

const PUBLIC = 'isPublic';
/** Route reachable without a session (login, webhook). */
export const Public = () => SetMetadata(PUBLIC, true);

export type AuthedRequest = Request & { user?: SessionUser };

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user;
});

/**
 * Every route except the public ones requires an Administrator session (NFR-13).
 * State-changing requests must also carry the X-Requested-With header, which a
 * cross-site form cannot set (CSRF protection on top of the SameSite cookie).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.headers['x-requested-with']) {
      throw new AppError(403, 'CSRF', 'En-tête X-Requested-With manquant.');
    }
    const user = await this.auth.resolve(req.cookies?.[SESSION_COOKIE]);
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Session expirée. Veuillez vous reconnecter.');
    req.user = user;
    return true;
  }
}
