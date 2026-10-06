import { Injectable } from '@nestjs/common';
import { AcademicYear } from '@prisma/client';
import { badRequest } from '../core/errors';
import { PrismaService, Tx } from '../core/prisma.service';

@Injectable()
export class OrgService {
  constructor(private readonly prisma: PrismaService) {}

  async activeYear(tx?: Tx): Promise<AcademicYear> {
    const year = await (tx ?? this.prisma).academicYear.findFirst({ where: { isActive: true } });
    if (!year) throw badRequest('NO_ACTIVE_YEAR', "Aucune année scolaire active. Créez-en une dans « Années ».");
    return year;
  }

  async activeYearOrNull(): Promise<AcademicYear | null> {
    return this.prisma.academicYear.findFirst({ where: { isActive: true } });
  }
}
