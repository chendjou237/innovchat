import { Inject, Injectable, Logger } from '@nestjs/common';
import { META_CATEGORIES, META_STATUSES, MetaCategory, MetaStatus, TemplatePurpose } from '@innovcare/shared';
import { MessageTemplate, Prisma } from '@prisma/client';
import { badRequest, notFound } from '../core/errors';
import { PrismaService } from '../core/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RecipientsService } from '../recipients/recipients.service';
import { RenderingService, fillBody } from '../recipients/rendering.service';
import { WHATSAPP_PROVIDER, WhatsAppProvider } from '../whatsapp/provider';

const BLOCKING: MetaStatus[] = ['PAUSED', 'DISABLED', 'REJECTED'];

export function assertUsable(t: Pick<MessageTemplate, 'metaStatus' | 'title'>) {
  if (t.metaStatus !== 'APPROVED') {
    throw badRequest('TEMPLATE_NOT_APPROVED', `Le modèle « ${t.title} » n'est pas approuvé par Meta (statut : ${t.metaStatus}).`);
  }
}

/** Message templates linked to Meta (FR-TPL-001..005, §6.2). */
@Injectable()
export class TemplatesService {
  private readonly logger = new Logger('Templates');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
    private readonly notifications: NotificationsService,
    private readonly recipients: RecipientsService,
    private readonly rendering: RenderingService,
  ) {}

  list() {
    return this.prisma.messageTemplate.findMany({ orderBy: [{ purpose: 'asc' }, { title: 'asc' }] });
  }

  async get(id: string) {
    const t = await this.prisma.messageTemplate.findUnique({ where: { id } });
    if (!t) throw notFound('Modèle introuvable');
    return t;
  }

  /** Default template for a purpose: an approved one if any. */
  async forPurpose(purpose: TemplatePurpose): Promise<MessageTemplate> {
    const t =
      (await this.prisma.messageTemplate.findFirst({ where: { purpose, metaStatus: 'APPROVED' }, orderBy: { createdAt: 'asc' } })) ??
      (await this.prisma.messageTemplate.findFirst({ where: { purpose }, orderBy: { createdAt: 'asc' } }));
    if (!t) throw badRequest('NO_TEMPLATE', `Aucun modèle de message pour l'usage ${purpose}.`);
    return t;
  }

  create(input: { title: string; meta_name: string; meta_category: MetaCategory; purpose: TemplatePurpose; body_preview: string; parameter_map: string[] }) {
    return this.prisma.messageTemplate.create({
      data: {
        title: input.title,
        metaName: input.meta_name,
        metaCategory: input.meta_category,
        purpose: input.purpose,
        bodyPreview: input.body_preview,
        parameterMap: input.parameter_map,
      },
    });
  }

  update(id: string, input: { title?: string; purpose?: TemplatePurpose; parameter_map?: string[] }) {
    return this.prisma.messageTemplate.update({
      where: { id },
      data: { title: input.title, purpose: input.purpose, parameterMap: input.parameter_map as Prisma.InputJsonValue | undefined },
    });
  }

  /**
   * Reads the template list from the WhatsApp Business Account and updates meta_status
   * (on demand and every 6 hours). A template that becomes PAUSED, DISABLED or REJECTED
   * raises a dashboard notification.
   */
  async sync() {
    const remote = await this.provider.listTemplates();
    const local = await this.prisma.messageTemplate.findMany();
    let updated = 0;
    let created = 0;
    for (const r of remote) {
      if (!r.language.startsWith('fr')) continue;
      const status = (META_STATUSES as readonly string[]).includes(r.status) ? (r.status as MetaStatus) : 'PENDING';
      const category = (META_CATEGORIES as readonly string[]).includes(r.category) ? (r.category as MetaCategory) : 'UTILITY';
      const existing = local.find((t) => t.metaName === r.name && t.language === r.language);
      if (existing) {
        if (existing.metaStatus !== status && BLOCKING.includes(status)) {
          await this.notifications.raise('TEMPLATE_REJECTED', `Modèle « ${existing.title} » : statut Meta ${status}. Les nouveaux envois sont bloqués.`, '/messages/modeles', `template-${existing.id}`);
        }
        await this.prisma.messageTemplate.update({
          where: { id: existing.id },
          // Meta may reclassify a template (e.g. as Marketing), which changes its price.
          data: { metaStatus: status, metaCategory: category, bodyPreview: r.body || existing.bodyPreview, lastSyncedAt: new Date() },
        });
        updated++;
      } else {
        // Template created in WhatsApp Manager: register it; parameters must be mapped before use.
        const params = (r.body.match(/\{\{\d+\}\}/g) ?? []).length;
        await this.prisma.messageTemplate.create({
          data: {
            title: r.name,
            metaName: r.name,
            language: r.language,
            metaCategory: category,
            purpose: 'GENERAL',
            bodyPreview: r.body,
            parameterMap: Array.from({ length: params }, () => ''),
            metaStatus: status,
            lastSyncedAt: new Date(),
          },
        });
        created++;
      }
    }
    this.logger.log(`sync: ${updated} updated, ${created} created`);
    return { updated, created };
  }

  /** Preview with real data (first matching student) or sample data (FR-TPL-005). */
  async preview(id: string, studentId?: string, shared: Record<string, string> = {}) {
    const t = await this.get(id);
    const ctx = await this.rendering.sampleContext();
    let student = this.rendering.sampleStudent();
    let contact: { name: string } | null = { name: 'M. Ngono' };
    if (studentId) {
      const r = await this.recipients.resolve({ student_ids: [studentId] });
      const s = r.students[0] ?? r.withoutContact[0];
      if (s) {
        student = s;
        contact = s.contacts[0] ?? null;
      }
    }
    const params = this.rendering.render(t, student, contact, ctx, { message: 'Texte de votre annonce', ...shared });
    return { params, text: fillBody(t.bodyPreview, params) };
  }
}
