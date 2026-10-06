import { Controller, Get, HttpCode, Logger, Post, Query, RawBodyRequest, Req, Res } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/auth.guard';
import { AppError } from '../core/errors';
import { PrismaService } from '../core/prisma.service';
import { QueueService } from '../core/queues';
import { SettingsService } from '../settings/settings.service';

export function validSignature(raw: Buffer, header: string | undefined, secret: string): boolean {
  if (!header || !secret || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'));
  const given = Buffer.from(header.slice(7));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Meta status webhook (SRS §6.3). The only route that needs no session. */
@Public()
@Controller('webhooks/whatsapp')
export class WebhooksController {
  private readonly logger = new Logger('Webhook');

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly settings: SettingsService,
  ) {}

  /** Verification: answers Meta's challenge when hub.verify_token matches. */
  @Get()
  async verify(@Query() q: Record<string, string>, @Res() res: Response) {
    const { verifyToken } = await this.settings.whatsapp();
    if (q['hub.mode'] === 'subscribe' && verifyToken && q['hub.verify_token'] === verifyToken) {
      res.status(200).type('text/plain').send(q['hub.challenge'] ?? '');
      return;
    }
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Jeton de vérification invalide.' } });
  }

  /** Rejects unsigned events, stores the raw event, answers 200 at once and processes it from the queue. */
  @Post()
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>) {
    const { appSecret } = await this.settings.whatsapp();
    if (!req.rawBody || !validSignature(req.rawBody, req.header('x-hub-signature-256'), appSecret)) {
      this.logger.warn('webhook rejected: bad signature');
      throw new AppError(401, 'INVALID_SIGNATURE', 'Signature invalide.');
    }
    const event = await this.prisma.webhookEvent.create({ data: { body: req.body as Prisma.InputJsonValue } });
    await this.queues.processWebhook(event.id);
    return { ok: true };
  }
}
