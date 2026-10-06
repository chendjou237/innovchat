import { formatInstantFr } from '@innovcare/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Pager, Select, Stat, Table, Td, statusTone, useToast, xaf } from '../components/ui';
import { api, fileUrl, qs } from '../lib/api';
import { DISPATCH_STATUS, MESSAGE_STATUS, PURPOSE, SOURCE } from '../lib/fr';
import type { Dispatch, Paged, SchoolClass } from '../lib/types';

/** Historique: dispatches, filterable and exportable (FR-DLV-006). */
export default function History() {
  const [params, setParams] = useSearchParams();
  const classes = useQuery({ queryKey: ['classes'], queryFn: () => api.get<SchoolClass[]>('/classes') });
  const f = {
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    purpose: params.get('purpose') ?? '',
    status: params.get('status') ?? '',
    class_id: params.get('class_id') ?? '',
    page: Number(params.get('page') ?? 1),
  };
  const set = (patch: Partial<typeof f>) => {
    const next = { ...f, page: 1, ...patch };
    setParams(Object.fromEntries(Object.entries(next).filter(([, v]) => v !== '' && v !== 1).map(([k, v]) => [k, String(v)])));
  };
  const query = useMemo(() => qs({ ...f, page_size: 30 }), [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useQuery({ queryKey: ['dispatches', query], queryFn: () => api.get<Paged<Dispatch>>(`/dispatches${query}`), refetchInterval: 15_000 });

  return (
    <>
      <PageHeader title="Historique" description="Tous les envois et le statut de chaque message (distribué, lu, échec)." />
      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <Field label="Du" className="w-40">
            <Input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} />
          </Field>
          <Field label="Au" className="w-40">
            <Input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} />
          </Field>
          <Field label="Type" className="w-36">
            <Select value={f.purpose} onChange={(e) => set({ purpose: e.target.value })}>
              <option value="">Tous</option>
              {Object.entries(PURPOSE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Statut" className="w-48">
            <Select value={f.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="">Tous</option>
              {['PROCESSING', 'COMPLETED', 'COMPLETED_WITH_FAILURES', 'SCHEDULED', 'CANCELLED'].map((s) => (
                <option key={s} value={s}>
                  {DISPATCH_STATUS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Classe" className="w-36">
            <Select value={f.class_id} onChange={(e) => set({ class_id: e.target.value })}>
              <option value="">Toutes</option>
              {classes.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <a className="ml-auto" href={fileUrl(`/dispatches/export${qs({ from: f.from, to: f.to, purpose: f.purpose, status: f.status, class_id: f.class_id })}`)}>
            <Button>Exporter (Excel)</Button>
          </a>
        </div>
        {list.isLoading ? (
          <Loading />
        ) : !list.data?.items.length ? (
          <Empty title="Aucun envoi" />
        ) : (
          <>
            <Table head={['Envoi', 'Date', 'Source', 'Statut', 'Messages', 'Coût estimé']}>
              {list.data.items.map((d) => (
                <tr key={d.id} className="hover:bg-stone-50">
                  <Td>
                    <Link to={`/historique/${d.id}`} className="font-medium hover:underline">
                      {d.title}
                    </Link>
                    <div className="text-xs text-muted">{d.template?.title}</div>
                  </Td>
                  <Td className="tnum whitespace-nowrap text-muted">{formatInstantFr(d.startedAt ?? d.scheduledFor ?? d.createdAt)}</Td>
                  <Td>{SOURCE[d.source]}</Td>
                  <Td>
                    <Badge tone={statusTone(d.status)}>{DISPATCH_STATUS[d.status]}</Badge>
                  </Td>
                  <Td className="tnum">
                    <Counts counts={d.counts ?? {}} total={d.messagesCount} />
                  </Td>
                  <Td className="tnum whitespace-nowrap">{xaf(d.estimatedCostXaf)}</Td>
                </tr>
              ))}
            </Table>
            <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => set({ page: p })} />
          </>
        )}
      </Card>
    </>
  );
}

function Counts({ counts, total }: { counts: Record<string, number>; total: number }) {
  const ok = (counts.SENT ?? 0) + (counts.DELIVERED ?? 0) + (counts.READ ?? 0);
  const failed = counts.FAILED ?? 0;
  return (
    <span className="whitespace-nowrap">
      {ok}/{total}
      {failed > 0 && <span className="ml-1.5 text-red-700">· {failed} échec(s)</span>}
    </span>
  );
}

interface MessageRow {
  id: string;
  status: string;
  phoneMasked: string;
  error_reason: string | null;
  attemptCount: number;
  nextAttemptAt: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  student: { id: string; name: string; matricule: string; class: string };
  contact: { id: string; name: string; relationship: string };
}

/** One dispatch: per-message status, error reasons, resend with a corrected number (FR-DLV-005, UC-06). */
export function HistoryDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [fix, setFix] = useState<MessageRow | null>(null);
  const [phone, setPhone] = useState('');

  const d = useQuery({ queryKey: ['dispatch', id], queryFn: () => api.get<Dispatch>(`/dispatches/${id}`), refetchInterval: (q) => (q.state.data?.status === 'PROCESSING' ? 3000 : 20_000) });
  const msgs = useQuery({
    queryKey: ['dispatch-messages', id, status],
    queryFn: () => api.get<MessageRow[]>(`/dispatches/${id}/messages${qs({ status })}`),
    refetchInterval: d.data?.status === 'PROCESSING' ? 3000 : 20_000,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['dispatch', id] });
    void qc.invalidateQueries({ queryKey: ['dispatch-messages', id] });
  };
  const resend = useMutation({
    mutationFn: (v: { id: string; phone?: string }) => api.post(`/messages/${v.id}/resend`, { phone: v.phone }),
    onSuccess: () => {
      toast('Message renvoyé');
      setFix(null);
      setPhone('');
      refresh();
    },
  });
  const resendAll = useMutation({
    mutationFn: () => api.post<{ resent: number }>(`/dispatches/${id}/resend-failed`),
    onSuccess: (r) => {
      toast(`${r.resent} message(s) renvoyé(s)`);
      refresh();
    },
  });

  if (!d.data) return <Loading />;
  const c = d.data.counts ?? {};
  const failed = c.FAILED ?? 0;
  return (
    <>
      <PageHeader
        title={d.data.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(d.data.status)}>{DISPATCH_STATUS[d.data.status]}</Badge>
            {SOURCE[d.data.source]} · {d.data.template?.title} · {formatInstantFr(d.data.startedAt ?? d.data.scheduledFor ?? d.data.createdAt)}
            {d.data.cancelReason && <span className="text-red-700">· {d.data.cancelReason}</span>}
          </span>
        }
        actions={
          <>
            <Link to="/historique">
              <Button variant="ghost">← Historique</Button>
            </Link>
            {failed > 0 && (
              <Button onClick={() => resendAll.mutate()} loading={resendAll.isPending}>
                Renvoyer les {failed} échecs
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Messages" value={d.data.messagesCount} hint={`${d.data.studentsCount} élèves`} />
        <Stat label="En file / nouvel essai" value={(c.QUEUED ?? 0) + (c.RETRY_PENDING ?? 0)} />
        <Stat label="Distribués" value={(c.DELIVERED ?? 0) + (c.READ ?? 0)} hint={`dont ${c.READ ?? 0} lus`} />
        <Stat label="Échecs" value={failed} tone={failed ? 'red' : undefined} />
        <Stat label="Coût estimé" value={xaf(d.data.estimatedCostXaf)} />
      </div>
      <Card
        padded={false}
        title="Messages"
        actions={
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 w-44 text-[13px]">
            <option value="">Tous les statuts</option>
            {Object.entries(MESSAGE_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        }
      >
        {msgs.isLoading ? (
          <Loading />
        ) : !msgs.data?.length ? (
          <Empty title={d.data.status === 'SCHEDULED' ? 'Les messages seront créés au moment de l’envoi.' : 'Aucun message'} />
        ) : (
          <Table head={['Élève', 'Parent', 'Numéro', 'Statut', 'Détail', '']}>
            {msgs.data.map((m) => (
              <tr key={m.id}>
                <Td>
                  <Link to={`/eleves/${m.student.id}`} className="hover:underline">
                    {m.student.name}
                  </Link>
                  <div className="text-xs text-muted">{m.student.class}</div>
                </Td>
                <Td>
                  {m.contact.name}
                  {m.contact.relationship && <div className="text-xs text-muted">{m.contact.relationship}</div>}
                </Td>
                <Td className="tnum whitespace-nowrap">{m.phoneMasked}</Td>
                <Td>
                  <Badge tone={statusTone(m.status)}>{MESSAGE_STATUS[m.status]}</Badge>
                </Td>
                <Td className="text-xs text-muted">
                  {m.error_reason && <div className={m.status === 'FAILED' ? 'text-red-700' : 'text-amber-800'}>{m.error_reason}</div>}
                  {m.status === 'RETRY_PENDING' && m.nextAttemptAt && <div>Essai {m.attemptCount + 1} à {formatInstantFr(m.nextAttemptAt).slice(11)}</div>}
                  {m.readAt ? `Lu ${formatInstantFr(m.readAt)}` : m.deliveredAt ? `Distribué ${formatInstantFr(m.deliveredAt)}` : m.sentAt ? `Envoyé ${formatInstantFr(m.sentAt)}` : ''}
                </Td>
                <Td className="whitespace-nowrap text-right">
                  {m.status === 'FAILED' && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setFix(m)}>
                        Corriger le numéro
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => resend.mutate({ id: m.id })}>
                        Renvoyer
                      </Button>
                    </>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal
        open={!!fix}
        onClose={() => setFix(null)}
        title="Corriger le numéro et renvoyer"
        footer={
          <>
            <Button onClick={() => setFix(null)}>Annuler</Button>
            <Button variant="primary" disabled={!phone.trim()} loading={resend.isPending} onClick={() => fix && resend.mutate({ id: fix.id, phone })}>
              Enregistrer et renvoyer
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted">
          {fix?.contact.name}, parent de {fix?.student.name}. Ancien numéro : {fix?.phoneMasked}. {fix?.error_reason}
        </p>
        <Field label="Nouveau numéro WhatsApp" hint="9 chiffres (6XX XX XX XX) ou format international +237…">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="6XX XX XX XX" autoFocus />
        </Field>
        <p className="mt-2 text-xs text-muted">Le contact du parent est aussi corrigé pour les prochains envois.</p>
        <div className="mt-3">
          <ErrorNote error={resend.error} />
        </div>
      </Modal>
    </>
  );
}
