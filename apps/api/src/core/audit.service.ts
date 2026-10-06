import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from './prisma.service';

/** Records who did what and when (NFR-15). */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    actorId: string | null | undefined,
    action: string,
    entity: string,
    entityId?: string | null,
    payload: Record<string, unknown> = {},
    tx?: Tx,
  ) {
    return (tx ?? this.prisma).auditLog.create({
      data: { actorId: actorId ?? null, action, entity, entityId: entityId ?? null, payload: payload as Prisma.InputJsonValue },
    });
  }
}
