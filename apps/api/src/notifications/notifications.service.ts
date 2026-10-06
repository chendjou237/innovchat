import { Injectable } from '@nestjs/common';
import type { NotificationType } from '@innovcare/shared';
import { PrismaService } from '../core/prisma.service';

/** Dashboard notifications behind the bell (§2.1, FR-DLV-004). Email alerts are out of scope for v1. */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates a notification, or refreshes the one with the same groupKey and marks it unread. */
  raise(type: NotificationType, title: string, link: string, groupKey?: string) {
    if (!groupKey) return this.prisma.notification.create({ data: { type, title, link } });
    return this.prisma.notification.upsert({
      where: { groupKey },
      create: { type, title, link, groupKey },
      update: { type, title, link, isRead: false, createdAt: new Date() },
    });
  }

  clear(groupKey: string) {
    return this.prisma.notification.deleteMany({ where: { groupKey } });
  }

  /** Keeps the "N alerts awaiting confirmation" notification in step (UC-01 step 3). */
  async refreshAwaitingConfirmation() {
    const n = await this.prisma.dispatch.count({ where: { status: 'AWAITING_CONFIRMATION', source: 'ATTENDANCE' } });
    if (n === 0) return this.clear('awaiting-confirmation');
    const title = n === 1 ? '1 alerte en attente de confirmation' : `${n} alertes en attente de confirmation`;
    const existing = await this.prisma.notification.findUnique({ where: { groupKey: 'awaiting-confirmation' } });
    if (existing?.title === title) return existing;
    return this.raise('AWAITING_CONFIRMATION', title, '/alertes', 'awaiting-confirmation');
  }

  async list() {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({ orderBy: [{ isRead: 'asc' }, { createdAt: 'desc' }], take: 50 }),
      this.prisma.notification.count({ where: { isRead: false } }),
    ]);
    return { unread, items };
  }

  markRead(id: string) {
    return this.prisma.notification.update({ where: { id }, data: { isRead: true } });
  }

  markAllRead() {
    return this.prisma.notification.updateMany({ where: { isRead: false }, data: { isRead: true } });
  }
}
