import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, Card, Checkbox, Empty, Field, Loading, Modal, PageHeader, Textarea, useToast } from '../components/ui';
import { api } from '../lib/api';
import { ANOMALY } from '../lib/fr';

interface Alert {
  id: string;
  type: string;
  date: string;
  subject: string | null;
  time_slot: string | null;
  arrival_time: string | null;
  note: string | null;
  student: { id: string; name: string; matricule: string };
  class: string;
  template_status: string;
  has_contact: boolean;
  recipients: { name: string; phone: string }[];
  previews: string[];
}

/** Alertes à confirmer (FR-ATT-005, §9.2). */
export default function Alerts() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['alerts'], queryFn: () => api.get<Alert[]>('/alerts/pending') });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [discarding, setDiscarding] = useState(false);
  const [reason, setReason] = useState('');

  const refresh = () => {
    setSel(new Set());
    void qc.invalidateQueries({ queryKey: ['alerts'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const confirm = useMutation({
    mutationFn: (ids: string[]) => api.post<{ confirmed: number; skipped: { id: string; reason: string }[] }>('/alerts/confirm', { alert_ids: ids }),
    onSuccess: (r) => {
      toast(`${r.confirmed} alerte(s) envoyée(s)${r.skipped.length ? ` · ${r.skipped.length} ignorée(s)` : ''}`, r.skipped.length ? 'error' : 'ok');
      refresh();
    },
  });
  const discard = useMutation({
    mutationFn: () => api.post('/alerts/discard', { alert_ids: [...sel], reason }),
    onSuccess: () => {
      toast('Alerte(s) écartée(s)');
      setDiscarding(false);
      setReason('');
      refresh();
    },
  });

  const items = q.data ?? [];
  const confirmable = items.filter((a) => a.has_contact && a.template_status === 'APPROVED');
  const allSelected = confirmable.length > 0 && confirmable.every((a) => sel.has(a.id));
  const toggle = (id: string, on: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  return (
    <>
      <PageHeader
        title="Alertes à confirmer"
        description="Relisez chaque message tel que le parent le recevra. Confirmez pour l’envoyer, ou écartez-le avec un motif."
        actions={
          items.length > 0 && (
            <>
              <Button variant="danger" disabled={sel.size === 0} onClick={() => setDiscarding(true)}>
                Écarter ({sel.size})
              </Button>
              <Button variant="primary" disabled={sel.size === 0} loading={confirm.isPending} onClick={() => confirm.mutate([...sel])}>
                Confirmer et envoyer ({sel.size})
              </Button>
            </>
          )
        }
      />
      {q.isLoading ? (
        <Loading />
      ) : items.length === 0 ? (
        <Card>
          <Empty title="Aucune alerte en attente">
            Les absences et retards saisis apparaissent ici avant envoi. <Link to="/absences" className="text-brand-700 underline">Saisir des absences</Link>
          </Empty>
        </Card>
      ) : (
        <>
          <div className="mb-2 px-1">
            <Checkbox checked={allSelected} indeterminate={sel.size > 0} onChange={(on) => setSel(on ? new Set(confirmable.map((a) => a.id)) : new Set())} label="Tout sélectionner" />
          </div>
          <ul className="space-y-2">
            {items.map((a) => (
              <li key={a.id} className={`rounded-xl border bg-white p-4 ${sel.has(a.id) ? 'border-brand-500 ring-2 ring-brand-100' : 'border-line'}`}>
                <div className="flex flex-wrap items-start gap-3">
                  <Checkbox checked={sel.has(a.id)} onChange={(on) => toggle(a.id, on)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Link to={`/eleves/${a.student.id}`} className="font-medium hover:underline">
                        {a.student.name}
                      </Link>
                      <span className="text-muted">{a.class}</span>
                      <Badge tone={a.type === 'ABSENCE' ? 'amber' : 'blue'}>{ANOMALY[a.type]}</Badge>
                      <span className="text-muted">
                        {a.date.split('-').reverse().join('/')} · {a.type === 'ABSENCE' ? [a.subject, a.time_slot].filter(Boolean).join(' · ') : `arrivée ${a.arrival_time?.replace(':', 'h')}`}
                      </span>
                      {!a.has_contact && <Badge tone="red">Aucun contact</Badge>}
                      {a.template_status !== 'APPROVED' && <Badge tone="red">Modèle non approuvé</Badge>}
                    </div>
                    {a.note && <div className="mt-1 text-xs text-muted">Note : {a.note}</div>}
                    <div className="mt-2 space-y-2">
                      {a.previews.map((p, i) => (
                        <div key={i} className="rounded-lg bg-[#efeae2] p-2">
                          <div className="mb-1 text-[11px] text-stone-500">{a.recipients[i] ? `À ${a.recipients[i].name} · ${a.recipients[i].phone}` : 'Aperçu'}</div>
                          <div className="rounded-md bg-white px-3 py-2 text-[13px] leading-relaxed shadow-sm">{p}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <Modal
        open={discarding}
        onClose={() => setDiscarding(false)}
        title={`Écarter ${sel.size} alerte(s)`}
        footer={
          <>
            <Button onClick={() => setDiscarding(false)}>Annuler</Button>
            <Button variant="danger" disabled={!reason.trim()} loading={discard.isPending} onClick={() => discard.mutate()}>
              Écarter
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted">Aucun message ne sera envoyé. L’anomalie reste enregistrée ; le motif est conservé dans le journal.</p>
        <Field label="Motif">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="L’élève était arrivé, erreur de saisie…" autoFocus />
        </Field>
      </Modal>
    </>
  );
}
