import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list() {
    return this.notifications.list();
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll() {
    await this.notifications.markAllRead();
    return { ok: true };
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(@Param('id', ParseUUIDPipe) id: string) {
    await this.notifications.markRead(id);
    return { ok: true };
  }
}
