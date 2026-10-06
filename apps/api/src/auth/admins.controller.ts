import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { createAdminSchema, resetPasswordSchema, updateAdminSchema } from '@innovcare/shared';
import { z } from 'zod';
import { AuditService } from '../core/audit.service';
import { badRequest } from '../core/errors';
import { PrismaService } from '../core/prisma.service';
import { ZodPipe } from '../core/zod.pipe';
import { CurrentUser } from './auth.guard';
import { AuthService, SessionUser } from './auth.service';

const publicFields = { id: true, email: true, fullName: true, role: true, isActive: true, lastLoginAt: true, createdAt: true } as const;

/** Administrator accounts (FR-ORG-005). */
@Controller('admins')
export class AdminsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.prisma.adminUser.findMany({ select: publicFields, orderBy: { createdAt: 'asc' } });
  }

  @Post()
  async create(@CurrentUser() me: SessionUser, @Body(new ZodPipe(createAdminSchema)) body: z.infer<typeof createAdminSchema>) {
    const admin = await this.prisma.adminUser.create({
      data: { email: body.email, fullName: body.fullName, passwordHash: await AuthService.hash(body.password) },
      select: publicFields,
    });
    await this.audit.log(me.id, 'CREATE', 'admin_user', admin.id, { email: admin.email });
    return admin;
  }

  @Patch(':id')
  async update(
    @CurrentUser() me: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateAdminSchema)) body: z.infer<typeof updateAdminSchema>,
  ) {
    if (body.isActive === false && id === me.id) throw badRequest('SELF_DEACTIVATION', 'Vous ne pouvez pas désactiver votre propre compte.');
    const admin = await this.prisma.adminUser.update({ where: { id }, data: body, select: publicFields });
    if (body.isActive === false) await this.auth.revokeAll(id);
    await this.audit.log(me.id, 'UPDATE', 'admin_user', id, body);
    return admin;
  }

  @Post(':id/reset-password')
  async resetPassword(
    @CurrentUser() me: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>,
  ) {
    await this.prisma.adminUser.update({ where: { id }, data: { passwordHash: await AuthService.hash(body.password) } });
    await this.auth.revokeAll(id);
    await this.audit.log(me.id, 'RESET_PASSWORD', 'admin_user', id);
    return { ok: true };
  }
}
