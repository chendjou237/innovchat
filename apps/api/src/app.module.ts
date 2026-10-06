import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AttendanceController } from './attendance/attendance.controller';
import { AdminsController } from './auth/admins.controller';
import { AuthController } from './auth/auth.controller';
import { AuthGuard, Public } from './auth/auth.guard';
import { CalendarController } from './calendar/calendar.controller';
import { DispatchesController } from './dispatches/dispatches.controller';
import { DomainModule } from './domain.module';
import { FeesController } from './fees/fees.controller';
import { ImportsController } from './imports/imports.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { AcademicYearsController, ClassesController, DepartmentsController, SubjectsController } from './org/org.controller';
import { PromotionsController } from './promotions/promotions.controller';
import { ReportsController } from './reports/reports.controller';
import { SettingsController } from './settings/settings.controller';
import { StudentsController } from './students/students.controller';
import { TemplatesController } from './templates/templates.controller';
import { WebhooksController } from './webhooks/webhooks.controller';

@Public()
@Controller('health')
class HealthController {
  @Get()
  health() {
    return { ok: true };
  }
}

@Module({
  imports: [DomainModule],
  controllers: [
    HealthController,
    AuthController,
    AdminsController,
    SettingsController,
    AcademicYearsController,
    DepartmentsController,
    ClassesController,
    SubjectsController,
    StudentsController,
    ImportsController,
    PromotionsController,
    AttendanceController,
    CalendarController,
    FeesController,
    TemplatesController,
    DispatchesController,
    NotificationsController,
    ReportsController,
    WebhooksController,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
