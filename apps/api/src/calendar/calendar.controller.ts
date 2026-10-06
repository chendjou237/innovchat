import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Put, Post, Query } from '@nestjs/common';
import { calendarEventSchema } from '@innovcare/shared';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth.service';
import { ZodPipe } from '../core/zod.pipe';
import { CalendarService } from './calendar.service';

type EventBody = z.infer<typeof calendarEventSchema>;

/** Calendar events and their triggers (triggers are saved with the event). */
@Controller('calendar/events')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  list(@Query('from') from?: string, @Query('to') to?: string) {
    return this.calendar.list(from, to);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.calendar.get(id);
  }

  @Post()
  create(@CurrentUser() me: SessionUser, @Body(new ZodPipe(calendarEventSchema)) body: EventBody) {
    return this.calendar.save(body, me.id);
  }

  @Put(':id')
  update(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(calendarEventSchema)) body: EventBody) {
    return this.calendar.save(body, me.id, id);
  }

  @Delete(':id')
  remove(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.calendar.remove(id, me.id);
  }

  @Get(':id/triggers')
  async triggers(@Param('id', ParseUUIDPipe) id: string) {
    return (await this.calendar.get(id)).triggers;
  }
}
