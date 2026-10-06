export interface RemoteTemplate {
  name: string;
  language: string;
  status: string; // APPROVED, PENDING, REJECTED, PAUSED, DISABLED, ...
  category: string; // UTILITY, MARKETING, AUTHENTICATION
  body: string;
}

export type SendResult = { ok: true; wamid: string } | { ok: false; code: string; message: string };

/** Outgoing side of the WhatsApp Cloud API (SRS §6.1, §6.2). */
export interface WhatsAppProvider {
  sendTemplate(to: string, metaName: string, language: string, params: string[]): Promise<SendResult>;
  listTemplates(): Promise<RemoteTemplate[]>;
}

export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');
