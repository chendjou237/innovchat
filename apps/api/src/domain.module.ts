import { Global, Module } from '@nestjs/common';
import { AttendanceService } from './attendance/attendance.service';
import { AuthService } from './auth/auth.service';
import { CalendarService } from './calendar/calendar.service';
import { AuditService } from './core/audit.service';
import { env } from './core/config';
import { CryptoService } from './core/crypto.service';
import { PrismaService } from './core/prisma.service';
import { QueueService } from './core/queues';
import { REDIS, createRedis } from './core/redis';
import { DeliveryService } from './delivery/delivery.service';
import { DispatchesService } from './dispatches/dispatches.service';
import { FeesService } from './fees/fees.service';
import { LedgerService } from './fees/ledger.service';
import { ImportsService } from './imports/imports.service';
import { NotificationsService } from './notifications/notifications.service';
import { OrgService } from './org/org.service';
import { PromotionsService } from './promotions/promotions.service';
import { RecipientsService } from './recipients/recipients.service';
import { RenderingService } from './recipients/rendering.service';
import { ReportsService } from './reports/reports.service';
import { SettingsService } from './settings/settings.service';
import { StudentsService } from './students/students.service';
import { TemplatesService } from './templates/templates.service';
import { GraphWhatsAppProvider } from './whatsapp/graph.provider';
import { MockWhatsAppProvider } from './whatsapp/mock.provider';
import { WHATSAPP_PROVIDER } from './whatsapp/provider';

const services = [
  PrismaService,
  CryptoService,
  AuditService,
  QueueService,
  SettingsService,
  AuthService,
  NotificationsService,
  OrgService,
  LedgerService,
  StudentsService,
  RecipientsService,
  RenderingService,
  TemplatesService,
  DispatchesService,
  DeliveryService,
  AttendanceService,
  CalendarService,
  FeesService,
  ImportsService,
  PromotionsService,
  ReportsService,
];

/** Every service, shared by the API process and the worker process. */
@Global()
@Module({
  providers: [
    ...services,
    { provide: REDIS, useFactory: createRedis },
    {
      provide: WHATSAPP_PROVIDER,
      inject: [SettingsService, PrismaService],
      useFactory: (settings: SettingsService, prisma: PrismaService) =>
        env().WHATSAPP_PROVIDER === 'graph' ? new GraphWhatsAppProvider(settings) : new MockWhatsAppProvider(settings, prisma),
    },
  ],
  exports: [...services, REDIS, WHATSAPP_PROVIDER],
})
export class DomainModule {}
