import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { ReportsService } from './reports.service';

@Controller()
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('reports/dashboard')
  dashboard() {
    return this.reports.dashboard();
  }

  @Get('reports/monthly')
  monthly(@Query('months') months?: string) {
    return this.reports.monthly(Math.min(36, Math.max(1, Number(months) || 12)));
  }

  /** Audit trail (NFR-15). */
  @Get('audit')
  audit(@Query('entity') entity?: string, @Query('entity_id') entityId?: string) {
    return this.prisma.auditLog.findMany({
      where: { ...(entity ? { entity } : {}), ...(entityId ? { entityId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
