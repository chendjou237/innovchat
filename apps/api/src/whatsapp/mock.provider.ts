import { Logger } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { env } from '../core/config';
import { PrismaService } from '../core/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { RemoteTemplate, SendResult, WhatsAppProvider } from './provider';

/**
 * Offline stand-in for the Cloud API, used in development and tests.
 * Failure injection by the number's last digits:
 *   …0000 → 131026 number not on WhatsApp (permanent)
 *   …0001 → 100 invalid parameter (permanent)
 *   …0002 → 130429 rate limit (temporary, every attempt)
 *   …0003 → 131000 server error on the first attempt only (temporary, then succeeds)
 *   …0004 → accepted, then a "failed" webhook with 131026
 * Other numbers: accepted, then sent → delivered (→ read when the number is even)
 * webhooks, signed with the app secret, posted to MOCK_WEBHOOK_URL.
 */
export class MockWhatsAppProvider implements WhatsAppProvider {
  private readonly logger = new Logger('MockWhatsApp');
  private readonly flaky = new Set<string>();
  /** Every accepted send, for tests. */
  static readonly sent: { to: string; metaName: string; params: string[]; wamid: string }[] = [];

  constructor(
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  async sendTemplate(to: string, metaName: string, _language: string, params: string[]): Promise<SendResult> {
    const tail = to.slice(-4);
    if (tail === '0000') return { ok: false, code: '131026', message: 'Message undeliverable' };
    if (tail === '0001') return { ok: false, code: '100', message: 'Invalid parameter' };
    if (tail === '0002') return { ok: false, code: '130429', message: 'Rate limit hit' };
    if (tail === '0003' && !this.flaky.has(to)) {
      this.flaky.add(to);
      return { ok: false, code: '131000', message: 'Something went wrong' };
    }
    const wamid = `wamid.MOCK.${randomUUID()}`;
    MockWhatsAppProvider.sent.push({ to, metaName, params, wamid });
    this.logger.log(`→ ${to} ${metaName}(${params.join(' | ')})`);

    const delay = env().MOCK_WEBHOOK_DELAY_MS;
    if (delay > 0) {
      const lastDigit = Number(to.slice(-1));
      const chain: { status: string; error?: { code: number; title: string } }[] =
        tail === '0004'
          ? [{ status: 'sent' }, { status: 'failed', error: { code: 131026, title: 'Message undeliverable' } }]
          : [{ status: 'sent' }, { status: 'delivered' }, ...(lastDigit % 2 === 0 ? [{ status: 'read' }] : [])];
      chain.forEach((s, i) => setTimeout(() => void this.postWebhook(wamid, to, s.status, s.error), delay * (i + 1)));
    }
    return { ok: true, wamid };
  }

  private async postWebhook(wamid: string, to: string, status: string, error?: { code: number; title: string }) {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'MOCK_WABA',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                statuses: [
                  {
                    id: wamid,
                    status,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    recipient_id: to.replace('+', ''),
                    ...(error ? { errors: [error] } : {}),
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const { appSecret } = await this.settings.whatsapp();
    const signature = 'sha256=' + createHmac('sha256', appSecret).update(body).digest('hex');
    try {
      await fetch(env().MOCK_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature }, body });
    } catch (e) {
      this.logger.warn(`mock webhook not delivered: ${(e as Error).message}`);
    }
  }

  /** Reports every local template as approved so development works without Meta. */
  async listTemplates(): Promise<RemoteTemplate[]> {
    const local = await this.prisma.messageTemplate.findMany();
    return local.map((t) => ({ name: t.metaName, language: t.language, status: 'APPROVED', category: t.metaCategory, body: t.bodyPreview }));
  }
}
