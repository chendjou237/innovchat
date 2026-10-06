import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { changePasswordSchema, loginSchema } from '@innovcare/shared';
import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { isProd } from '../core/config';
import { AppError } from '../core/errors';
import { PrismaService } from '../core/prisma.service';
import { ZodPipe } from '../core/zod.pipe';
import { CurrentUser, Public } from './auth.guard';
import { AuthService, SESSION_COOKIE, SESSION_TTL_S, SessionUser } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.auth.login(body.email, body.password);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd(),
      path: '/',
      maxAge: SESSION_TTL_S * 1000 * 3, // the server-side TTL is the real limit
    });
    return { user };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: SessionUser) {
    return { user };
  }

  @Post('password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: SessionUser,
    @Body(new ZodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>,
  ) {
    const u = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await bcrypt.compare(body.currentPassword, u.passwordHash))) {
      throw new AppError(400, 'INVALID_PASSWORD', 'Mot de passe actuel incorrect.');
    }
    await this.prisma.adminUser.update({ where: { id: user.id }, data: { passwordHash: await AuthService.hash(body.newPassword) } });
    return { ok: true };
  }
}
