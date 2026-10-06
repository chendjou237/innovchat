import { Injectable } from '@nestjs/common';
import { MetaCategory, SCHOOL_TZ, parseDay, toDay } from '@innovcare/shared';
import { fromZonedTime } from 'date-fns-tz';
import { PrismaService } from '../core/prisma.service';
import { SettingsService } from '../settings/settings.service';

/** Monthly spend report (FR-CST-003) and the home dashboard (§9). */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Messages accepted by WhatsApp (sent, delivered or read) per month and Meta category, with estimated spend. */
  async monthly(months = 12) {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
    const rows = await this.prisma.$queryRaw<{ month: string; category: MetaCategory; messages: number }[]>`
      SELECT to_char(date_trunc('month', m.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${SCHOOL_TZ}), 'YYYY-MM') AS month,
             t.meta_category::text AS category,
             count(*)::int AS messages
      FROM message m
      JOIN dispatch d ON d.id = m.dispatch_id
      JOIN message_template t ON t.id = d.template_id
      WHERE m.status IN ('SENT', 'DELIVERED', 'READ') AND m.created_at >= ${start}
      GROUP BY 1, 2
      ORDER BY 1, 2`;
    const prices = await this.settings.prices();
    return {
      prices,
      rows: rows.map((r) => ({ ...r, estimated_xaf: Math.round(r.messages * prices[r.category]) })),
    };
  }

  async dashboard() {
    const today = toDay(new Date());
    const monthStart = fromZonedTime(`${today.slice(0, 7)}-01T00:00:00`, SCHOOL_TZ);
    const weekAgo = new Date(Date.now() - 7 * 86400000);

    const [anomalies, awaiting, scheduled, failedRows, monthly, students] = await Promise.all([
      this.prisma.attendanceAnomaly.findMany({
        where: { date: parseDay(today) },
        orderBy: { createdAt: 'desc' },
        include: { subject: { select: { name: true } }, enrolment: { include: { student: { select: { id: true, firstName: true, lastName: true } }, class: { select: { name: true } } } } },
      }),
      this.prisma.dispatch.count({ where: { status: 'AWAITING_CONFIRMATION', source: 'ATTENDANCE' } }),
      this.prisma.dispatch.findMany({
        where: { status: 'SCHEDULED' },
        orderBy: { scheduledFor: 'asc' },
        take: 5,
        select: { id: true, title: true, source: true, scheduledFor: true, messagesCount: true, estimatedCostXaf: true },
      }),
      this.prisma.message.groupBy({ by: ['dispatchId'], where: { status: 'FAILED', failedAt: { gte: weekAgo } }, _count: { _all: true } }),
      this.prisma.$queryRaw<{ category: MetaCategory; messages: number }[]>`
        SELECT t.meta_category::text AS category, count(*)::int AS messages
        FROM message m JOIN dispatch d ON d.id = m.dispatch_id JOIN message_template t ON t.id = d.template_id
        WHERE m.status IN ('SENT', 'DELIVERED', 'READ') AND m.created_at >= ${monthStart}
        GROUP BY 1`,
      this.prisma.student.count({ where: { status: 'ACTIVE' } }),
    ]);
    const dispatchTitles = await this.prisma.dispatch.findMany({ where: { id: { in: failedRows.map((f) => f.dispatchId) } }, select: { id: true, title: true } });
    const titleOf = new Map(dispatchTitles.map((d) => [d.id, d.title]));
    const prices = await this.settings.prices();

    return {
      today,
      students,
      anomalies_today: anomalies.map((a) => ({
        id: a.id,
        type: a.type,
        student: `${a.enrolment.student.lastName} ${a.enrolment.student.firstName}`,
        student_id: a.enrolment.student.id,
        class: a.enrolment.class.name,
        subject: a.subject?.name ?? null,
        arrival_time: a.arrivalTime,
      })),
      alerts_awaiting: awaiting,
      next_scheduled: scheduled,
      failures_7d: {
        total: failedRows.reduce((n, f) => n + f._count._all, 0),
        by_dispatch: failedRows.map((f) => ({ id: f.dispatchId, title: titleOf.get(f.dispatchId) ?? '', failed: f._count._all })),
      },
      month: {
        messages: monthly.reduce((n, r) => n + r.messages, 0),
        estimated_xaf: Math.round(monthly.reduce((n, r) => n + r.messages * prices[r.category], 0)),
      },
    };
  }
}
