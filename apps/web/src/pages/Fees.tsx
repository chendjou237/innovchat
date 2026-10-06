import { RecipientFilter, formatInstantFr, toDay } from '@innovcare/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import RecipientSelector, { emptyFilter } from '../components/RecipientSelector';
import { Badge, Button, Card, Checkbox, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Select, Table, Tabs, Td, cx, statusTone, useToast, xaf } from '../components/ui';
import { api, qs } from '../lib/api';
import { DISPATCH_STATUS } from '../lib/fr';
import type { Paged, SchoolClass } from '../lib/types';
import { schoolLocalToIso } from './NewDispatch';

interface Rule {
  id: string;
  daysOffset: number;
  sendTime: string;
  isEnabled: boolean;
  recipientFilter: RecipientFilter;
  dispatch: { id: string; status: string; scheduledFor: string | null } | null;
}
interface Installment {
  id: string;
  name: string;
  due_date: string;
  defaultAmountXaf: number;
  classAmounts: Record<string, number>;
  rules: Rule[];
  totals: { due: number; paid: number; balance: number; unpaid_students: number; students: number };
}
interface ClassSummary {
  class_id: string;
  class_name: string;
  students: number;
  unpaid: number;
  due: number;
  paid: number;
  balance: number;
}
interface StudentBalance {
  student: { id: string; name: string; matricule: string };
  class: { id: string; name: string };
  due: number;
  paid: number;
  balance: number;
  is_override: boolean;
}

const offsetLabel = (o: number) => (o === 0 ? 'le jour de l’échéance' : o < 0 ? `${-o} j avant l’échéance` : `${o} j après l’échéance`);

/** Frais scolaires: installments, unpaid lists, payments, reminder rules, Prepare reminder (FR-FEE, UC-03). */
export default function Fees() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['installments'], queryFn: () => api.get<Installment[]>('/fees/installments') });
  const [selId, setSelId] = useState('');
  const [editInst, setEditInst] = useState<Partial<Installment> | null>(null);
  const [paying, setPaying] = useState<StudentBalance | null | 'new'>(null);
  const [reminding, setReminding] = useState(false);
  const [tab, setTab] = useState<'classes' | 'regles'>('classes');

  useEffect(() => {
    if (!selId && list.data?.length) setSelId(list.data[0].id);
  }, [list.data, selId]);
  const inst = list.data?.find((i) => i.id === selId);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['installments'] });
    void qc.invalidateQueries({ queryKey: ['fee-classes'] });
    void qc.invalidateQueries({ queryKey: ['fee-students'] });
  };

  return (
    <>
      <PageHeader
        title="Frais scolaires"
        description="Tranches de l’année active, soldes par élève et rappels envoyés uniquement aux soldes impayés."
        actions={
          <>
            <Link to="/import">
              <Button>Importer des paiements</Button>
            </Link>
            <Button onClick={() => setPaying('new')} disabled={!inst}>
              Saisir un paiement
            </Button>
            <Button variant="primary" onClick={() => setReminding(true)} disabled={!inst || !inst.totals.unpaid_students}>
              Préparer un rappel
            </Button>
          </>
        }
      />
      {list.isLoading ? (
        <Loading />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <Card title="Tranches" actions={<Button size="sm" onClick={() => setEditInst({})}>Ajouter</Button>} padded={false}>
            {!list.data?.length ? (
              <Empty title="Aucune tranche">Ex. « 1ère tranche », échéance et montant en FCFA.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {list.data.map((i) => (
                  <li key={i.id}>
                    <button onClick={() => setSelId(i.id)} className={cx('block w-full px-4 py-3 text-left text-sm', i.id === selId ? 'bg-brand-50' : 'hover:bg-stone-50')}>
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{i.name}</span>
                        <span className="tnum text-xs text-muted">{i.due_date.split('-').reverse().join('/')}</span>
                      </div>
                      <div className="tnum mt-1 text-xs text-muted">
                        {i.totals.unpaid_students} impayé(s) · reste {xaf(i.totals.balance)}
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-stone-200">
                        <div className="h-full bg-brand-500" style={{ width: `${i.totals.due ? Math.round((i.totals.paid / i.totals.due) * 100) : 0}%` }} />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {inst ? (
            <div className="min-w-0">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">{inst.name}</h2>
                  <p className="tnum text-sm text-muted">
                    Échéance {inst.due_date.split('-').reverse().join('/')} · {xaf(inst.defaultAmountXaf)} par défaut · encaissé {xaf(inst.totals.paid)} sur {xaf(inst.totals.due)}
                  </p>
                </div>
                <Button size="sm" onClick={() => setEditInst(inst)}>Modifier la tranche</Button>
              </div>
              <Tabs value={tab} onChange={setTab} items={[{ value: 'classes', label: 'Impayés par classe' }, { value: 'regles', label: `Rappels automatiques (${inst.rules.length})` }]} />
              {tab === 'classes' ? <ClassesView inst={inst} onPay={(s) => setPaying(s)} onChanged={refresh} /> : <RulesView inst={inst} onChanged={refresh} />}
            </div>
          ) : (
            !!list.data?.length || <Card><Empty title="Créez une première tranche pour commencer." /></Card>
          )}
        </div>
      )}
      {editInst && <InstallmentForm inst={editInst} onClose={() => setEditInst(null)} onSaved={refresh} />}
      {paying && inst && <PaymentForm inst={inst} preset={paying === 'new' ? null : paying} onClose={() => setPaying(null)} onSaved={refresh} />}
      {reminding && inst && <ReminderModal inst={inst} onClose={() => setReminding(false)} />}
    </>
  );
}

function ClassesView({ inst, onPay, onChanged }: { inst: Installment; onPay: (s: StudentBalance) => void; onChanged: () => void }) {
  const toast = useToast();
  const summary = useQuery({ queryKey: ['fee-classes', inst.id], queryFn: () => api.get<ClassSummary[]>(`/fees/installments/${inst.id}/classes`) });
  const [classId, setClassId] = useState('');
  const [onlyUnpaid, setOnlyUnpaid] = useState(true);
  const students = useQuery({
    queryKey: ['fee-students', inst.id, classId, onlyUnpaid],
    enabled: !!classId,
    queryFn: () => api.get<StudentBalance[]>(`/fees/students${qs({ installment_id: inst.id, class_id: classId, unpaid: onlyUnpaid })}`),
  });
  const override = useMutation({
    mutationFn: (v: { student_id: string; amount: number | null }) => api.put('/fees/students', { student_id: v.student_id, installment_id: inst.id, amount_due_xaf: v.amount }),
    onSuccess: () => (toast('Montant mis à jour'), onChanged()),
    onError: (e) => toast((e as Error).message, 'error'),
  });

  return (
    <div className="space-y-4">
      <Card padded={false}>
        {summary.isLoading ? (
          <Loading />
        ) : !summary.data?.length ? (
          <Empty title="Aucun élève inscrit" />
        ) : (
          <Table head={['Classe', 'Élèves', 'Impayés', 'Dû', 'Encaissé', 'Reste']}>
            {summary.data.map((c) => (
              <tr key={c.class_id} onClick={() => setClassId(c.class_id)} className={cx('cursor-pointer', classId === c.class_id ? 'bg-brand-50' : 'hover:bg-stone-50')}>
                <Td className="font-medium">{c.class_name}</Td>
                <Td className="tnum">{c.students}</Td>
                <Td className="tnum">{c.unpaid > 0 ? <span className="font-medium text-red-700">{c.unpaid}</span> : <span className="text-emerald-700">0</span>}</Td>
                <Td className="tnum">{xaf(c.due)}</Td>
                <Td className="tnum">{xaf(c.paid)}</Td>
                <Td className="tnum font-medium">{xaf(c.balance)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {classId && (
        <Card
          title={`${summary.data?.find((c) => c.class_id === classId)?.class_name ?? ''} — soldes`}
          actions={<Checkbox checked={onlyUnpaid} onChange={setOnlyUnpaid} label="Impayés seulement" />}
          padded={false}
        >
          {students.isLoading ? (
            <Loading />
          ) : !students.data?.length ? (
            <Empty title="Tous les élèves sont à jour" />
          ) : (
            <Table head={['Élève', 'Dû', 'Payé', 'Reste', '']}>
              {students.data.map((s) => (
                <tr key={s.student.id}>
                  <Td>
                    <Link to={`/eleves/${s.student.id}`} className="hover:underline">{s.student.name}</Link>
                    <div className="text-xs text-muted">{s.student.matricule}</div>
                  </Td>
                  <Td className="tnum whitespace-nowrap">
                    {xaf(s.due)} {s.is_override && <Badge tone="blue">individuel</Badge>}
                  </Td>
                  <Td className="tnum whitespace-nowrap">{xaf(s.paid)}</Td>
                  <Td className={cx('tnum whitespace-nowrap font-medium', s.balance > 0 ? 'text-red-700' : 'text-emerald-700')}>{xaf(s.balance)}</Td>
                  <Td className="whitespace-nowrap text-right">
                    <Button size="sm" variant="ghost" onClick={() => onPay(s)}>Paiement</Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const v = prompt('Montant individuel en FCFA (bourse, réduction fratrie…). Laissez vide pour revenir au montant de la classe.', s.is_override ? String(s.due) : '');
                        if (v === null) return;
                        const n = v.trim() === '' ? null : Number(v.replace(/\s/g, ''));
                        if (n !== null && (!Number.isInteger(n) || n < 0)) return toast('Montant invalide', 'error');
                        override.mutate({ student_id: s.student.id, amount: n });
                      }}
                    >
                      Montant…
                    </Button>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}

function RulesView({ inst, onChanged }: { inst: Installment; onChanged: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<{ id?: string; days_offset: number; send_time: string; is_enabled: boolean } | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { installment_id: inst.id, days_offset: form!.days_offset, send_time: form!.send_time, is_enabled: form!.is_enabled, recipient_filter: { whole_school: true } };
      return form!.id ? api.put(`/fees/rules/${form!.id}`, body) : api.post('/fees/rules', body);
    },
    onSuccess: () => (toast('Règle enregistrée'), setForm(null), onChanged()),
  });
  const toggle = useMutation({
    mutationFn: (r: Rule) => api.put(`/fees/rules/${r.id}`, { installment_id: inst.id, days_offset: r.daysOffset, send_time: r.sendTime, is_enabled: !r.isEnabled, recipient_filter: r.recipientFilter }),
    onSuccess: () => onChanged(),
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/fees/rules/${id}`), onSuccess: () => onChanged() });

  return (
    <Card
      title="Rappels automatiques"
      actions={<Button size="sm" onClick={() => setForm({ days_offset: -7, send_time: '08:00', is_enabled: true })}>Ajouter une règle</Button>}
      padded={false}
    >
      <p className="border-b border-line px-4 py-2.5 text-xs text-muted">
        Désactivés par défaut. Chaque règle programme un rappel pour toute l’école ; les soldes sont relus au moment de l’envoi, les élèves à jour sont exclus.
      </p>
      {inst.rules.length === 0 ? (
        <Empty title="Aucune règle" />
      ) : (
        <ul className="divide-y divide-line">
          {inst.rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <Checkbox checked={r.isEnabled} onChange={() => toggle.mutate(r)} />
              <span className="flex-1">
                {offsetLabel(r.daysOffset)}, à {r.sendTime}
              </span>
              {r.dispatch && (
                <Badge tone={statusTone(r.dispatch.status)}>
                  {DISPATCH_STATUS[r.dispatch.status]}
                  {r.dispatch.status === 'SCHEDULED' && r.dispatch.scheduledFor && ` · ${formatInstantFr(r.dispatch.scheduledFor)}`}
                </Badge>
              )}
              <Button size="sm" variant="ghost" onClick={() => setForm({ id: r.id, days_offset: r.daysOffset, send_time: r.sendTime, is_enabled: r.isEnabled })}>
                Modifier
              </Button>
              <Button size="sm" variant="ghost" className="text-red-700" onClick={() => confirm('Supprimer cette règle ?') && remove.mutate(r.id)}>
                Supprimer
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title="Règle de rappel"
        footer={
          <>
            <Button onClick={() => setForm(null)}>Annuler</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Enregistrer</Button>
          </>
        }
      >
        {form && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Jours">
                <Input type="number" min={0} className="w-20" value={Math.abs(form.days_offset)} onChange={(e) => setForm({ ...form, days_offset: Math.sign(form.days_offset || -1) * Number(e.target.value) })} />
              </Field>
              <Select
                className="w-48"
                value={form.days_offset === 0 ? 'same' : form.days_offset < 0 ? 'before' : 'after'}
                onChange={(e) => setForm({ ...form, days_offset: e.target.value === 'same' ? 0 : (e.target.value === 'before' ? -1 : 1) * (Math.abs(form.days_offset) || 1) })}
              >
                <option value="before">avant l’échéance</option>
                <option value="same">le jour de l’échéance</option>
                <option value="after">après l’échéance</option>
              </Select>
              <Field label="Heure">
                <Input type="time" className="w-28" value={form.send_time} onChange={(e) => setForm({ ...form, send_time: e.target.value })} />
              </Field>
            </div>
            <Checkbox checked={form.is_enabled} onChange={(v) => setForm({ ...form, is_enabled: v })} label="Activée" />
            <ErrorNote error={save.error} />
          </div>
        )}
      </Modal>
    </Card>
  );
}

function InstallmentForm({ inst, onClose, onSaved }: { inst: Partial<Installment>; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const classes = useQuery({ queryKey: ['classes'], queryFn: () => api.get<SchoolClass[]>('/classes') });
  const [f, setF] = useState({ name: inst.name ?? '', due_date: inst.due_date ?? '', default_amount_xaf: String(inst.defaultAmountXaf ?? '') });
  const [perClass, setPerClass] = useState<Record<string, string>>(Object.fromEntries(Object.entries(inst.classAmounts ?? {}).map(([k, v]) => [k, String(v)])));
  const body = () => ({
    name: f.name,
    due_date: f.due_date,
    default_amount_xaf: Number(f.default_amount_xaf.replace(/\s/g, '')),
    class_amounts: Object.fromEntries(Object.entries(perClass).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, Number(v.replace(/\s/g, ''))])),
  });
  const save = useMutation({
    mutationFn: () => (inst.id ? api.put(`/fees/installments/${inst.id}`, body()) : api.post('/fees/installments', body())),
    onSuccess: () => (toast('Tranche enregistrée'), onSaved(), onClose()),
  });
  const remove = useMutation({ mutationFn: () => api.del(`/fees/installments/${inst.id}`), onSuccess: () => (toast('Tranche supprimée'), onSaved(), onClose()) });
  return (
    <Modal
      open
      onClose={onClose}
      title={inst.id ? 'Modifier la tranche' : 'Nouvelle tranche'}
      footer={
        <>
          {inst.id && (
            <Button variant="danger" className="mr-auto" onClick={() => confirm('Supprimer cette tranche ?') && remove.mutate()}>
              Supprimer
            </Button>
          )}
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.name || !f.due_date || !f.default_amount_xaf} onClick={() => save.mutate()}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Nom">
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="1ère tranche" autoFocus />
          </Field>
          <Field label="Échéance">
            <Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
          </Field>
          <Field label="Montant (FCFA)">
            <Input inputMode="numeric" value={f.default_amount_xaf} onChange={(e) => setF({ ...f, default_amount_xaf: e.target.value })} />
          </Field>
        </div>
        <details className="rounded-lg border border-line">
          <summary className="cursor-pointer px-3 py-2 text-sm">Montant différent pour certaines classes</summary>
          <div className="grid gap-2 border-t border-line p-3 sm:grid-cols-3">
            {classes.data?.map((c) => (
              <Field key={c.id} label={c.name}>
                <Input inputMode="numeric" placeholder={f.default_amount_xaf || '—'} value={perClass[c.id] ?? ''} onChange={(e) => setPerClass({ ...perClass, [c.id]: e.target.value })} />
              </Field>
            ))}
          </div>
        </details>
        <ErrorNote error={save.error ?? remove.error} />
      </div>
    </Modal>
  );
}

function PaymentForm({ inst, preset, onClose, onSaved }: { inst: Installment; preset: StudentBalance | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [student, setStudent] = useState<{ id: string; name: string } | null>(preset ? preset.student : null);
  const [search, setSearch] = useState('');
  const [f, setF] = useState({ amount: preset ? String(preset.balance || '') : '', paid_on: toDay(new Date()), reference: '' });
  const results = useQuery({
    queryKey: ['pay-search', search],
    enabled: search.trim().length >= 2 && !student,
    queryFn: () => api.get<Paged<{ id: string; firstName: string; lastName: string; matricule: string; class: { name: string } | null }>>(`/students${qs({ q: search, page_size: 8 })}`),
  });
  const save = useMutation({
    mutationFn: () => api.post('/fees/payments', { student_id: student!.id, installment_id: inst.id, amount_xaf: Number(f.amount.replace(/\s/g, '')), paid_on: f.paid_on, reference: f.reference || null }),
    onSuccess: () => (toast('Paiement enregistré'), onSaved(), onClose()),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Paiement — ${inst.name}`}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={save.isPending} disabled={!student || !f.amount || !f.paid_on} onClick={() => save.mutate()}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {student ? (
          <div className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2 text-sm">
            <span className="font-medium">{student.name}</span>
            {!preset && <button className="text-xs text-brand-700 hover:underline" onClick={() => setStudent(null)}>Changer</button>}
          </div>
        ) : (
          <Field label="Élève">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom ou matricule" autoFocus />
            <ul className="mt-1 divide-y divide-line rounded-lg border border-line empty:hidden">
              {results.data?.items.map((s) => (
                <li key={s.id}>
                  <button className="block w-full px-3 py-1.5 text-left text-sm hover:bg-stone-50" onClick={() => setStudent({ id: s.id, name: `${s.lastName} ${s.firstName}` })}>
                    {s.lastName} {s.firstName} <span className="text-muted">· {s.class?.name} · {s.matricule}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Montant (FCFA)">
            <Input inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
          <Field label="Date">
            <Input type="date" value={f.paid_on} onChange={(e) => setF({ ...f, paid_on: e.target.value })} />
          </Field>
          <Field label="Référence">
            <Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="N° de reçu" />
          </Field>
        </div>
        <ErrorNote error={save.error} />
      </div>
    </Modal>
  );
}

/** Prepare reminder: scope, unpaid-only preview with each student's balance, send now or schedule (FR-FEE-005/006). */
function ReminderModal({ inst, onClose }: { inst: Installment; onClose: () => void }) {
  const toast = useToast();
  const nav = useNavigate();
  const [filter, setFilter] = useState<RecipientFilter>({ ...emptyFilter(), whole_school: true });
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState('');
  const tpl = useQuery({
    queryKey: ['reminder-template', inst.id],
    queryFn: () => api.post<{ template_id: string }>('/fees/reminders', { installment_id: inst.id, recipients_filter: { whole_school: true }, preview_only: true }),
  });
  const send = useMutation({
    mutationFn: () =>
      api.post<{ id: string; status: string; messages: number }>('/fees/reminders', {
        installment_id: inst.id,
        recipients_filter: filter,
        scheduled_for: when === 'later' ? schoolLocalToIso(at) : null,
      }),
    onSuccess: (r) => {
      toast(r.status === 'SCHEDULED' ? 'Rappel programmé' : `Rappel envoyé (${r.messages} messages)`);
      onClose();
      nav(r.status === 'SCHEDULED' ? '/programmes' : `/historique/${r.id}`);
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={`Rappel — ${inst.name}`}
      footer={
        <>
          <div className="mr-auto flex items-center gap-3 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" className="accent-brand-600" checked={when === 'now'} onChange={() => setWhen('now')} /> Maintenant
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" className="accent-brand-600" checked={when === 'later'} onChange={() => setWhen('later')} /> Programmer
            </label>
            {when === 'later' && <Input type="datetime-local" className="w-52" value={at} onChange={(e) => setAt(e.target.value)} />}
          </div>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={send.isPending} disabled={when === 'later' && !at} onClick={() => send.mutate()}>
            {when === 'now' ? 'Envoyer' : 'Programmer'}
          </Button>
        </>
      }
    >
      <RecipientSelector
        value={{ ...filter, fee_installment_unpaid: inst.id }}
        onChange={(v) => setFilter({ ...v, fee_installment_unpaid: null })}
        templateId={tpl.data?.template_id}
        unpaidLabel={`Seuls les élèves dont le solde de « ${inst.name} » est supérieur à zéro recevront le rappel, avec leur propre montant.`}
      />
      {when === 'later' && <p className="mt-2 text-xs text-muted">Les soldes seront relus au moment de l’envoi : un élève qui paie d’ici là ne recevra pas le rappel.</p>}
      <div className="mt-3">
        <ErrorNote error={send.error ?? tpl.error} />
      </div>
    </Modal>
  );
}
