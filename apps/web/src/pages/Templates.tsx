import { META_CATEGORIES, TEMPLATE_FIELDS, TEMPLATE_PURPOSES, fieldLabel } from '@innovcare/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Select, Textarea, statusTone, useToast } from '../components/ui';
import { api } from '../lib/api';
import { META_CATEGORY, META_STATUS, PURPOSE } from '../lib/fr';
import type { Template } from '../lib/types';
import { WhatsAppBubble } from './NewDispatch';

/** Modèles: Meta templates, sync status, parameter mapping, preview (FR-TPL-001..005). */
export default function Templates() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['templates'], queryFn: () => api.get<Template[]>('/templates') });
  const [edit, setEdit] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);
  const sync = useMutation({
    mutationFn: () => api.post<{ updated: number; created: number }>('/templates/sync'),
    onSuccess: (r) => {
      toast(`Synchronisé : ${r.updated} mis à jour, ${r.created} nouveau(x)`);
      void qc.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  return (
    <>
      <PageHeader
        title="Modèles de message"
        description="Les modèles sont créés et soumis à l’approbation de Meta dans WhatsApp Manager, en français. Seuls les modèles approuvés peuvent être envoyés. Synchronisation automatique toutes les 6 heures."
        actions={
          <>
            <Button onClick={() => setCreating(true)}>Déclarer un modèle</Button>
            <Button variant="primary" loading={sync.isPending} onClick={() => sync.mutate()}>Synchroniser avec Meta</Button>
          </>
        }
      />
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.length ? (
        <Card><Empty title="Aucun modèle" /></Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {q.data.map((t) => (
            <Card
              key={t.id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {t.title} <Badge tone={statusTone(t.metaStatus)}>{META_STATUS[t.metaStatus]}</Badge>
                </span>
              }
              actions={<Button size="sm" variant="ghost" onClick={() => setEdit(t)}>Paramètres</Button>}
            >
              <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                <span>Nom Meta : <code className="text-ink">{t.metaName}</code></span>
                <span>Usage : {PURPOSE[t.purpose]}</span>
                <span>Catégorie : {META_CATEGORY[t.metaCategory]}</span>
                {t.lastSyncedAt && <span>Synchronisé le {new Date(t.lastSyncedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>}
              </div>
              <p className="rounded-lg bg-stone-50 p-3 text-[13px] leading-relaxed">{t.bodyPreview}</p>
              {t.parameterMap.some((p) => !p) && <p className="mt-2 text-xs text-red-700">Paramètres non reliés : complétez-les avant utilisation.</p>}
            </Card>
          ))}
        </div>
      )}
      {edit && <MappingModal t={edit} onClose={() => setEdit(null)} />}
      {creating && <CreateModal onClose={() => setCreating(false)} />}
    </>
  );
}

function MappingModal({ t, onClose }: { t: Template; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const count = Math.max(t.parameterMap.length, (t.bodyPreview.match(/\{\{\d+\}\}/g) ?? []).length);
  const [map, setMap] = useState<string[]>(Array.from({ length: count }, (_, i) => t.parameterMap[i] ?? ''));
  const [purpose, setPurpose] = useState(t.purpose);
  const [title, setTitle] = useState(t.title);
  const preview = useQuery({ queryKey: ['tpl-preview', t.id, map.join()], queryFn: () => api.post<{ text: string }>(`/templates/${t.id}/preview`, {}) });
  const save = useMutation({
    mutationFn: () => api.patch(`/templates/${t.id}`, { title, purpose, parameter_map: map }),
    onSuccess: () => {
      toast('Modèle enregistré');
      void qc.invalidateQueries({ queryKey: ['templates'] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={`Modèle « ${t.metaName} »`}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={save.isPending} disabled={map.some((m) => !m)} onClick={() => save.mutate()}>Enregistrer</Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <Field label="Titre affiché">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Usage">
            <Select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
              {TEMPLATE_PURPOSES.map((p) => <option key={p} value={p}>{PURPOSE[p]}</option>)}
            </Select>
          </Field>
          {map.map((m, i) => (
            <Field key={i} label={`{{${i + 1}}}`}>
              <Select value={m} onChange={(e) => setMap(map.map((x, j) => (j === i ? e.target.value : x)))}>
                <option value="">— Relier à —</option>
                {Object.keys(TEMPLATE_FIELDS).map((k) => <option key={k} value={k}>{fieldLabel(k)}</option>)}
              </Select>
            </Field>
          ))}
        </div>
        <div>
          <div className="mb-1 text-[13px] font-medium">Aperçu (données d’exemple, version enregistrée)</div>
          <WhatsAppBubble text={preview.data?.text ?? t.bodyPreview} />
        </div>
      </div>
      <div className="mt-3"><ErrorNote error={save.error} /></div>
    </Modal>
  );
}

function CreateModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ title: '', meta_name: '', meta_category: 'UTILITY', purpose: 'GENERAL', body_preview: '' });
  const n = (f.body_preview.match(/\{\{\d+\}\}/g) ?? []).length;
  const save = useMutation({
    mutationFn: () => api.post('/templates', { ...f, parameter_map: Array.from({ length: n }, () => '') }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['templates'] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Déclarer un modèle soumis à Meta"
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.title || !f.meta_name || !f.body_preview} onClick={() => save.mutate()}>Ajouter</Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">Le nom doit être identique à celui saisi dans WhatsApp Manager. Le statut sera mis à jour à la prochaine synchronisation ; reliez ensuite les paramètres.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Titre"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Nom Meta"><Input value={f.meta_name} onChange={(e) => setF({ ...f, meta_name: e.target.value })} placeholder="convocation_parents" /></Field>
          <Field label="Catégorie">
            <Select value={f.meta_category} onChange={(e) => setF({ ...f, meta_category: e.target.value })}>
              {META_CATEGORIES.map((c) => <option key={c} value={c}>{META_CATEGORY[c]}</option>)}
            </Select>
          </Field>
          <Field label="Usage">
            <Select value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })}>
              {TEMPLATE_PURPOSES.map((p) => <option key={p} value={p}>{PURPOSE[p]}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Texte du modèle" hint={`${n} paramètre(s) détecté(s) : {{1}}, {{2}}…`}>
          <Textarea value={f.body_preview} onChange={(e) => setF({ ...f, body_preview: e.target.value })} />
        </Field>
        <ErrorNote error={save.error} />
      </div>
    </Modal>
  );
}
