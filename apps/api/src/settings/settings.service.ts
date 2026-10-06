import { Injectable } from '@nestjs/common';
import type { MetaCategory, SettingsInput } from '@innovcare/shared';
import { env } from '../core/config';
import { CryptoService } from '../core/crypto.service';
import { PrismaService } from '../core/prisma.service';

const SECRET_KEYS = new Set(['wa_access_token', 'wa_app_secret', 'wa_verify_token']);

export interface WhatsAppConfig {
  phoneNumberId: string;
  businessAccountId: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
  messagesPerSecond: number;
  dailyLimit: number;
}

/** Key/value settings (Paramètres screen). Secrets are encrypted and never returned (NFR-12, §6.1). */
@Injectable()
export class SettingsService {
  private cache: { at: number; values: Map<string, string> } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  private async all(): Promise<Map<string, string>> {
    if (this.cache && Date.now() - this.cache.at < 5000) return this.cache.values;
    const rows = await this.prisma.setting.findMany();
    const values = new Map<string, string>();
    for (const r of rows) values.set(r.key, r.isSecret ? this.crypto.decrypt(r.value) : r.value);
    this.cache = { at: Date.now(), values };
    return values;
  }

  async get(key: string): Promise<string | undefined> {
    return (await this.all()).get(key);
  }

  async update(input: SettingsInput) {
    for (const [key, raw] of Object.entries(input)) {
      if (raw === undefined) continue;
      const value = String(raw);
      // An empty secret field in the form means "keep the current value".
      if (SECRET_KEYS.has(key) && value === '') continue;
      const isSecret = SECRET_KEYS.has(key);
      const stored = isSecret ? this.crypto.encrypt(value) : value;
      await this.prisma.setting.upsert({
        where: { key },
        create: { key, value: stored, isSecret },
        update: { value: stored, isSecret },
      });
    }
    this.cache = null;
  }

  /** Public view for the settings screen: secrets reduced to "configured or not". */
  async publicView() {
    const v = await this.all();
    const wa = await this.whatsapp();
    const prices = await this.prices();
    return {
      school_name: v.get('school_name') ?? '',
      school_phone: v.get('school_phone') ?? '',
      wa_phone_number_id: wa.phoneNumberId,
      wa_business_account_id: wa.businessAccountId,
      wa_access_token_set: !!v.get('wa_access_token'),
      wa_app_secret_set: !!v.get('wa_app_secret'),
      wa_verify_token_set: !!v.get('wa_verify_token'),
      wa_messages_per_second: wa.messagesPerSecond,
      wa_daily_limit: wa.dailyLimit,
      price_utility_xaf: prices.UTILITY,
      price_marketing_xaf: prices.MARKETING,
      price_authentication_xaf: prices.AUTHENTICATION,
      provider: env().WHATSAPP_PROVIDER,
    };
  }

  async whatsapp(): Promise<WhatsAppConfig> {
    const v = await this.all();
    return {
      phoneNumberId: v.get('wa_phone_number_id') ?? '',
      businessAccountId: v.get('wa_business_account_id') ?? '',
      accessToken: v.get('wa_access_token') ?? '',
      appSecret: v.get('wa_app_secret') || env().META_APP_SECRET,
      verifyToken: v.get('wa_verify_token') || env().META_VERIFY_TOKEN,
      messagesPerSecond: Number(v.get('wa_messages_per_second') ?? 20),
      // Meta's starting tier allows 250 business-initiated conversations per 24 h.
      dailyLimit: Number(v.get('wa_daily_limit') ?? 250),
    };
  }

  /** Price per message for each Meta category, in FCFA (FR-CST-001). */
  async prices(): Promise<Record<MetaCategory, number>> {
    const v = await this.all();
    return {
      UTILITY: Number(v.get('price_utility_xaf') ?? 20),
      MARKETING: Number(v.get('price_marketing_xaf') ?? 45),
      AUTHENTICATION: Number(v.get('price_authentication_xaf') ?? 20),
    };
  }

  async school() {
    const v = await this.all();
    return { name: v.get('school_name') ?? "L'école", phone: v.get('school_phone') ?? '' };
  }
}
