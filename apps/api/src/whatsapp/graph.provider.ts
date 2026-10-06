import { Logger } from '@nestjs/common';
import { env } from '../core/config';
import { SettingsService } from '../settings/settings.service';
import { RemoteTemplate, SendResult, WhatsAppProvider } from './provider';

const TIMEOUT_MS = 15_000;

/** WhatsApp Cloud API over the Graph API, version pinned in configuration (§6.1). */
export class GraphWhatsAppProvider implements WhatsAppProvider {
  private readonly logger = new Logger('GraphWhatsApp');

  constructor(private readonly settings: SettingsService) {}

  private base() {
    return `https://graph.facebook.com/${env().META_GRAPH_VERSION}`;
  }

  async sendTemplate(to: string, metaName: string, language: string, params: string[]): Promise<SendResult> {
    const cfg = await this.settings.whatsapp();
    if (!cfg.accessToken || !cfg.phoneNumberId) {
      return { ok: false, code: 'NOT_CONFIGURED', message: 'Connexion WhatsApp non configurée (Paramètres).' };
    }
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: metaName,
        language: { code: language },
        components: params.length ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] : [],
      },
    };
    try {
      const res = await fetch(`${this.base()}/${cfg.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const json = (await res.json().catch(() => ({}))) as {
        messages?: { id: string }[];
        error?: { code?: number; message?: string; error_data?: { details?: string } };
      };
      if (res.ok && json.messages?.[0]?.id) return { ok: true, wamid: json.messages[0].id };
      const code = json.error?.code ?? (res.status >= 500 ? 131000 : res.status);
      return { ok: false, code: String(code), message: json.error?.error_data?.details ?? json.error?.message ?? `HTTP ${res.status}` };
    } catch (e) {
      const err = e as Error;
      this.logger.warn(`send failed: ${err.message}`);
      return { ok: false, code: err.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK', message: err.message };
    }
  }

  async listTemplates(): Promise<RemoteTemplate[]> {
    const cfg = await this.settings.whatsapp();
    if (!cfg.accessToken || !cfg.businessAccountId) throw new Error('Connexion WhatsApp non configurée (Paramètres).');
    const out: RemoteTemplate[] = [];
    let url: string | undefined =
      `${this.base()}/${cfg.businessAccountId}/message_templates?fields=name,language,status,category,components&limit=100`;
    while (url) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.accessToken}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const json = (await res.json()) as {
        data?: { name: string; language: string; status: string; category: string; components?: { type: string; text?: string }[] }[];
        paging?: { next?: string };
        error?: { message: string };
      };
      if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      for (const t of json.data ?? []) {
        out.push({
          name: t.name,
          language: t.language,
          status: t.status,
          category: t.category,
          body: t.components?.find((c) => c.type === 'BODY')?.text ?? '',
        });
      }
      url = json.paging?.next;
    }
    return out;
  }
}
