import { Body, Controller, Get, Put } from '@nestjs/common';
import { SettingsInput, settingsSchema } from '@innovcare/shared';
import { CurrentUser } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth.service';
import { AuditService } from '../core/audit.service';
import { ZodPipe } from '../core/zod.pipe';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  get() {
    return this.settings.publicView();
  }

  @Put()
  async update(@CurrentUser() me: SessionUser, @Body(new ZodPipe(settingsSchema)) body: SettingsInput) {
    await this.settings.update(body);
    // Never log secret values.
    await this.audit.log(me.id, 'UPDATE', 'setting', null, { keys: Object.keys(body) });
    return this.settings.publicView();
  }
}
