import { RecipientFilter, SCHOOL_TZ, fieldLabel, sharedParamNames } from '@innovcare/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatInTimeZone } from 'date-fns-tz';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import RecipientSelector, { emptyFilter, usePreview } from '../components/RecipientSelector';
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, Textarea, statusTone, useToast, xaf } from '../components/ui';
import { api } from '../lib/api';
import { META_STATUS, PURPOSE } from '../lib/fr';
import type { Dispatch, Template } from '../lib/types';

/** "2026-10-07T08:00" typed in school time → ISO string with the Douala offset. */
export const schoolLocalToIso = (local: string) => `${local}:00+01:00`;
export const isoToSchoolLocal = (iso: string) => formatInTimeZone(new Date(iso), SCHOOL_TZ, "yyyy-MM-dd'T'HH:mm");

/** Nouvel envoi: template, shared parameters, recipients, summary, send now or schedule (UC-02). */
export default function NewDispatch() {
  const [params] = useSearchParams();
  const editId = params.get('edit');
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  const templates = useQuery({ queryKey: ['templates'], queryFn: () => api.get<Template[]>('/templates') });
  const editing = useQuery({ queryKey: ['dispatch', editId], enabled: !!editId, queryFn: () => api.get<Dispatch>(`/dispatches/${editId}`) });

  const [templateId, setTemplateId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [shared, setShared] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<RecipientFilter>(emptyFilter());
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState('');
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const d = editing.data;
    if (!d) return;
    setTemplateId(d.templateId);
    setTitle(d.title);
    setShared(d.fixedParameters ?? {});
    setFilter({ ...emptyFilter(), ...d.recipientFilter });
    setWhen('later');
    if (d.scheduledFor) setAt(isoToSchoolLocal(d.scheduledFor));
  }, [editing.data]);

  // Default to the general announcement template.
  useEffect(() => {
    if (!templateId && !editId && templates.data?.length) {
      const t = templates.data.find((x) => x.purpose === 'GENERAL' && x.metaStatus === 'APPROVED') ?? templates.data.find((x) => x.metaStatus === 'APPROVED');
      if (t) setTemplateId(t.id);
    }
  }, [templates.data, templateId, editId]);

  const template = templates.data?.find((t) => t.id === templateId);
  const needed = useMemo(() => (template ? sharedParamNames(template.parameterMap) : []), [template]);
  const preview = usePreview(templateId || undefined, filter, shared);
  const missing = needed.filter((n) => !shared[n]?.trim());

  const send = useMutation({
    mutationFn: async () => {
      const scheduled_for = when === 'later' ? schoolLocalToIso(at) : null;
      if (editId) return api.patch<Dispatch>(`/dispatches/${editId}`, { title, parameters: shared, recipients_filter: filter, scheduled_for: scheduled_for ?? undefined });
      return api.post<{ id: string; status: string }>('/dispatches', { template_id: templateId, title: title || undefined, parameters: shared, recipients_filter: filter, scheduled_for });
    },
    onSuccess: (r) => {
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: ['scheduled'] });
      if (editId) {
        toast('Envoi programmé mis à jour');
        nav('/programmes');
      } else if (r.status === 'SCHEDULED') {
        toast('Envoi programmé');
        nav('/programmes');
      } else {
        toast('Envoi lancé');
        nav(`/historique/${r.id}`);
      }
    },
  });

  const canSend = !!templateId && template?.metaStatus === 'APPROVED' && missing.length === 0 && (preview.data?.messages ?? 0) > 0 && (when === 'now' || !!at);

  return (
    <>
      <PageHeader
        title={editId ? 'Modifier un envoi programmé' : 'Nouvel envoi'}
        description="Choisissez un modèle approuvé, complétez ses paramètres, sélectionnez les destinataires puis envoyez maintenant ou programmez l’envoi."
      />
      <div className="space-y-4">
        <Card title="1. Message">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <Field label="Modèle">
                <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} disabled={!!editId}>
                  <option value="">— Choisir —</option>
                  {templates.data?.map((t) => (
                    <option key={t.id} value={t.id} disabled={t.metaStatus !== 'APPROVED'}>
                      {t.title} ({PURPOSE[t.purpose]}){t.metaStatus !== 'APPROVED' ? ` — ${META_STATUS[t.metaStatus]}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              {needed.map((n) => (
                <Field key={n} label={fieldLabel(`param:${n}`).replace('Paramètre « message »', 'Message')} hint="Commun à tous les destinataires. Pas de retour à la ligne.">
                  <Textarea value={shared[n] ?? ''} maxLength={900} onChange={(e) => setShared((s) => ({ ...s, [n]: e.target.value }))} />
                </Field>
              ))}
              <Field label="Titre de l’envoi (facultatif)" hint="Sert à retrouver l’envoi dans l’historique.">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={template ? `${template.title} du …` : ''} />
              </Field>
            </div>
            <div>
              <div className="mb-1 flex items-center gap-2 text-[13px] font-medium">
                Aperçu {template && <Badge tone={statusTone(template.metaStatus)}>{META_STATUS[template.metaStatus]}</Badge>}
              </div>
              <WhatsAppBubble text={preview.data?.sample_message ?? template?.bodyPreview ?? ''} />
              <p className="mt-2 text-xs text-muted">Les champs propres à chaque élève (nom, classe, solde…) sont remplis automatiquement.</p>
            </div>
          </div>
        </Card>

        <Card title="2. Destinataires">
          <RecipientSelector value={filter} onChange={setFilter} templateId={templateId || undefined} parameters={shared} />
        </Card>

        <Card title="3. Envoi">
          <div className="flex flex-wrap items-end gap-4">
            {!editId && (
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" className="accent-brand-600" checked={when === 'now'} onChange={() => setWhen('now')} /> Envoyer maintenant
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" className="accent-brand-600" checked={when === 'later'} onChange={() => setWhen('later')} /> Programmer
                </label>
              </div>
            )}
            {when === 'later' && (
              <Field label="Date et heure (heure de Douala)">
                <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} min={isoToSchoolLocal(new Date().toISOString())} />
              </Field>
            )}
            <div className="ml-auto flex items-center gap-3">
              {missing.length > 0 && <span className="text-xs text-amber-800">Complétez le message.</span>}
              <Button variant="primary" disabled={!canSend} onClick={() => setConfirming(true)}>
                {editId ? 'Enregistrer' : when === 'now' ? 'Envoyer…' : 'Programmer…'}
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={when === 'now' ? 'Confirmer l’envoi' : 'Confirmer la programmation'}
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>Annuler</Button>
            <Button variant="primary" loading={send.isPending} onClick={() => send.mutate()}>
              {when === 'now' ? 'Envoyer maintenant' : 'Programmer'}
            </Button>
          </>
        }
      >
        {preview.data && (
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-muted">Élèves</dt>
            <dd className="tnum text-right font-medium">{preview.data.students}</dd>
            <dt className="text-muted">Messages</dt>
            <dd className="tnum text-right font-medium">{preview.data.messages}</dd>
            <dt className="text-muted">Sans contact (non envoyés)</dt>
            <dd className="tnum text-right font-medium">{preview.data.students_without_contact.length}</dd>
            <dt className="text-muted">Coût estimé</dt>
            <dd className="tnum text-right font-medium">{xaf(preview.data.estimated_cost_xaf)}</dd>
            {when === 'later' && (
              <>
                <dt className="text-muted">Date</dt>
                <dd className="text-right font-medium">{at.replace('T', ' à ')}</dd>
              </>
            )}
          </dl>
        )}
        <p className="mt-3 text-xs text-muted">
          {when === 'later' ? 'Les destinataires seront recalculés au moment de l’envoi.' : 'L’envoi continue en arrière-plan ; vous pouvez suivre les statuts dans l’historique.'}
        </p>
        <div className="mt-3">
          <ErrorNote error={send.error} />
        </div>
      </Modal>
    </>
  );
}

export function WhatsAppBubble({ text }: { text: string }) {
  return (
    <div className="rounded-xl bg-[#efeae2] p-3">
      <div className="max-w-[440px] whitespace-pre-wrap rounded-lg rounded-tl-none bg-white px-3 py-2 text-[13.5px] leading-relaxed shadow-sm">{text || '…'}</div>
    </div>
  );
}
