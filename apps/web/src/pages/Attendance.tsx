import { toDay } from '@innovcare/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, Card, Checkbox, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Select, Table, Tabs, Td, Textarea, useToast } from '../components/ui';
import { api, fileUrl, qs } from '../lib/api';
import { ANOMALY, DISPATCH_STATUS } from '../lib/fr';
import type { Paged, SchoolClass, Subject } from '../lib/types';

interface StudentRow {
  id: string;
  matricule: string;
  firstName: string;
  lastName: string;
  contacts: { isOptedOut: boolean }[];
}

interface Anomaly {
  id: string;
  type: string;
  date: string;
  subject: string | null;
  time_slot: string | null;
  arrival_time: string | null;
  note: string | null;
  is_justified: boolean;
  justification_note: string | null;
  student: { id: string; name: string; matricule: string };
  class: string;
  alert: { id: string; status: string } | null;
}

/** Absences et retards: record anomalies for a class (FR-ATT-001..003) and browse history (FR-ATT-008). */
export default function Attendance() {
  const [tab, setTab] = useState<'saisie' | 'historique'>('saisie');
  return (
    <>
      <PageHeader title="Absences et retards" description="Seules les anomalies sont saisies : les élèves présents ne sont pas enregistrés. Chaque anomalie crée une alerte à confirmer avant envoi." />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'saisie', label: 'Saisie' }, { value: 'historique', label: 'Historique' }]} />
      {tab === 'saisie' ? <Entry /> : <HistoryTab />}
    </>
  );
}

function Entry() {
  const toast = useToast();
  const qc = useQueryClient();
  const classes = useQuery({ queryKey: ['classes'], queryFn: () => api.get<SchoolClass[]>('/classes') });
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: () => api.get<Subject[]>('/subjects') });
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(toDay(new Date()));
  const [type, setType] = useState<'ABSENCE' | 'TARDINESS'>('ABSENCE');
  const [subjectId, setSubjectId] = useState('');
  const [timeSlot, setTimeSlot] = useState('');
  const [arrival, setArrival] = useState('');
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [created, setCreated] = useState(0);

  useEffect(() => setPicked(new Set()), [classId]);
  const students = useQuery({
    queryKey: ['class-students', classId],
    enabled: !!classId,
    queryFn: () => api.get<Paged<StudentRow>>(`/students${qs({ class_id: classId, page_size: 200 })}`),
  });

  const save = useMutation({
    mutationFn: () =>
      api.post<unknown[]>('/attendance/anomalies', {
        type,
        date,
        subject_id: subjectId || null,
        time_slot: type === 'ABSENCE' ? timeSlot || null : null,
        arrival_time: type === 'TARDINESS' ? arrival || null : null,
        student_ids: [...picked],
        note: note || null,
      }),
    onSuccess: (r) => {
      setCreated(r.length);
      setPicked(new Set());
      setNote('');
      toast(`${r.length} anomalie(s) enregistrée(s)`);
      void qc.invalidateQueries({ queryKey: ['anomalies'] });
    },
  });

  const valid = picked.size > 0 && (type === 'ABSENCE' ? !!subjectId : !!arrival);
  const items = students.data?.items ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <Card title="Anomalie">
        <div className="space-y-3">
          <Field label="Classe">
            <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">— Choisir —</option>
              {classes.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date">
            <Input type="date" value={date} max={toDay(new Date())} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Type">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-stone-100 p-1">
              {(['ABSENCE', 'TARDINESS'] as const).map((t) => (
                <button key={t} onClick={() => setType(t)} className={`rounded-md py-1.5 text-sm font-medium ${type === t ? 'bg-white shadow-sm' : 'text-muted'}`}>
                  {ANOMALY[t]}
                </button>
              ))}
            </div>
          </Field>
          <Field label={type === 'ABSENCE' ? 'Matière' : 'Matière (facultatif)'}>
            <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">—</option>
              {subjects.data
                ?.filter((s) => s.isActive)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
          </Field>
          {type === 'ABSENCE' ? (
            <Field label="Créneau (facultatif)" hint="Ex. 08:00-10:00">
              <Input value={timeSlot} onChange={(e) => setTimeSlot(e.target.value)} placeholder="08:00-10:00" />
            </Field>
          ) : (
            <Field label="Heure d’arrivée">
              <Input type="time" value={arrival} onChange={(e) => setArrival(e.target.value)} />
            </Field>
          )}
          <Field label="Note (facultatif)">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-14" />
          </Field>
        </div>
      </Card>

      <Card
        title={classId ? `Élèves concernés${picked.size ? ` · ${picked.size} sélectionné(s)` : ''}` : 'Élèves'}
        actions={
          <Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
            Enregistrer
          </Button>
        }
        padded={false}
      >
        {created > 0 && (
          <div className="border-b border-line bg-amber-50/70 px-4 py-2.5 text-sm text-amber-900">
            {created} alerte(s) créée(s), en attente de confirmation.{' '}
            <Link to="/alertes" className="font-medium underline">
              Confirmer les alertes →
            </Link>
          </div>
        )}
        <div className="px-4 pt-3">
          <ErrorNote error={save.error} />
        </div>
        {!classId && <Empty title="Choisissez une classe">Cochez ensuite les élèves absents ou en retard.</Empty>}
        {classId && students.isLoading && <Loading />}
        {classId && items.length > 0 && (
          <>
            <div className="flex items-center justify-between px-4 py-2 text-xs text-muted">
              <span>Cochez uniquement les élèves concernés.</span>
              {picked.size > 0 && (
                <button className="hover:underline" onClick={() => setPicked(new Set())}>
                  Tout décocher
                </button>
              )}
            </div>
            <ul className="grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-3">
              {items.map((s) => (
                <li key={s.id} className={`bg-white px-4 py-2 ${picked.has(s.id) ? 'bg-amber-50' : ''}`}>
                  <Checkbox
                    checked={picked.has(s.id)}
                    onChange={(on) =>
                      setPicked((p) => {
                        const n = new Set(p);
                        if (on) n.add(s.id);
                        else n.delete(s.id);
                        return n;
                      })
                    }
                    label={
                      <span>
                        {s.lastName} {s.firstName}
                        {!s.contacts.some((c) => !c.isOptedOut) && <span className="ml-1 text-xs text-amber-700">(sans contact)</span>}
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          </>
        )}
        {classId && students.data && items.length === 0 && <Empty title="Aucun élève dans cette classe" />}
      </Card>
    </div>
  );
}

function HistoryTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const classes = useQuery({ queryKey: ['classes'], queryFn: () => api.get<SchoolClass[]>('/classes') });
  const [f, setF] = useState({ class_id: '', type: '', from: '', to: '', justified: '' });
  const query = useMemo(() => qs(f), [f]);
  const list = useQuery({ queryKey: ['anomalies', query], queryFn: () => api.get<Anomaly[]>(`/attendance/anomalies${query}`) });
  const [justify, setJustify] = useState<Anomaly | null>(null);
  const [justNote, setJustNote] = useState('');

  const doJustify = useMutation({
    mutationFn: () => api.post(`/attendance/anomalies/${justify!.id}/justify`, { note: justNote }),
    onSuccess: () => {
      setJustify(null);
      setJustNote('');
      toast('Anomalie justifiée');
      void qc.invalidateQueries({ queryKey: ['anomalies'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/attendance/anomalies/${id}`),
    onSuccess: () => {
      toast('Anomalie supprimée');
      void qc.invalidateQueries({ queryKey: ['anomalies'] });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
        <Field label="Classe" className="w-40">
          <Select value={f.class_id} onChange={(e) => setF({ ...f, class_id: e.target.value })}>
            <option value="">Toutes</option>
            {classes.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Type" className="w-36">
          <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="">Tous</option>
            <option value="ABSENCE">Absences</option>
            <option value="TARDINESS">Retards</option>
          </Select>
        </Field>
        <Field label="Du" className="w-40">
          <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        </Field>
        <Field label="Au" className="w-40">
          <Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </Field>
        <Field label="Justification" className="w-36">
          <Select value={f.justified} onChange={(e) => setF({ ...f, justified: e.target.value })}>
            <option value="">Toutes</option>
            <option value="true">Justifiées</option>
            <option value="false">Non justifiées</option>
          </Select>
        </Field>
        <a href={fileUrl(`/attendance/anomalies/export${query}`)} className="ml-auto">
          <Button>Exporter (Excel)</Button>
        </a>
      </div>
      {list.isLoading ? (
        <Loading />
      ) : !list.data?.length ? (
        <Empty title="Aucune anomalie pour ces critères" />
      ) : (
        <Table head={['Date', 'Élève', 'Classe', 'Type', 'Détail', 'Alerte', '']}>
          {list.data.map((a) => {
            const editable = !a.alert || ['AWAITING_CONFIRMATION', 'CANCELLED'].includes(a.alert.status);
            return (
              <tr key={a.id}>
                <Td className="tnum whitespace-nowrap">{a.date.split('-').reverse().join('/')}</Td>
                <Td>
                  <Link to={`/eleves/${a.student.id}`} className="hover:underline">
                    {a.student.name}
                  </Link>
                </Td>
                <Td>{a.class}</Td>
                <Td>
                  <Badge tone={a.type === 'ABSENCE' ? 'amber' : 'blue'}>{ANOMALY[a.type]}</Badge>
                </Td>
                <Td className="text-muted">
                  {a.type === 'ABSENCE' ? [a.subject, a.time_slot].filter(Boolean).join(' · ') : `Arrivée ${a.arrival_time?.replace(':', 'h')}`}
                  {a.is_justified && <div className="text-xs text-emerald-700">Justifiée : {a.justification_note}</div>}
                </Td>
                <Td>{a.alert && <span className="text-xs text-muted">{DISPATCH_STATUS[a.alert.status]}</span>}</Td>
                <Td className="whitespace-nowrap text-right">
                  {!a.is_justified && (
                    <Button size="sm" variant="ghost" onClick={() => setJustify(a)}>
                      Justifier
                    </Button>
                  )}
                  {editable && (
                    <Button size="sm" variant="ghost" className="text-red-700" onClick={() => confirm('Supprimer cette anomalie et son alerte ?') && remove.mutate(a.id)}>
                      Supprimer
                    </Button>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
      <Modal
        open={!!justify}
        onClose={() => setJustify(null)}
        title="Justifier l’anomalie"
        footer={
          <>
            <Button onClick={() => setJustify(null)}>Annuler</Button>
            <Button variant="primary" disabled={!justNote.trim()} loading={doJustify.isPending} onClick={() => doJustify.mutate()}>
              Justifier
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted">
          {justify?.student.name} — {justify && ANOMALY[justify.type]} du {justify?.date.split('-').reverse().join('/')}
        </p>
        <Field label="Motif">
          <Textarea value={justNote} onChange={(e) => setJustNote(e.target.value)} placeholder="Certificat médical, rendez-vous…" autoFocus />
        </Field>
      </Modal>
    </Card>
  );
}
