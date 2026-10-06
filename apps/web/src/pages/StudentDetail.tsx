import { formatInstantFr, toDay } from '@innovcare/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Badge, Button, Card, Checkbox, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Select, Table, Tabs, Td, statusTone, useToast, xaf } from '../components/ui';
import { api } from '../lib/api';
import { ANOMALY, MESSAGE_STATUS, OUTCOME, PURPOSE, STUDENT_STATUS } from '../lib/fr';
import type { SchoolClass } from '../lib/types';

interface Contact {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  phoneMasked: string;
  consentAt: string | null;
  isOptedOut: boolean;
}
interface Detail {
  id: string;
  matricule: string;
  firstName: string;
  lastName: string;
  status: string;
  enrolments: { id: string; outcome: string | null; class: { id: string; name: string }; academicYear: { label: string; isActive: boolean } }[];
  contacts: Contact[];
  anomalies: { id: string; type: string; date: string; subject: { name: string } | null; arrivalTime: string | null; isJustified: boolean; dispatch: { status: string } | null }[];
  fees: { id: string; amountDueXaf: number; paid: number; balance: number; isOverride: boolean; installment: { name: string; dueDate: string }; payments: { id: string; amountXaf: number; paidOn: string; reference: string | null }[] }[];
  messages: { id: string; status: string; createdAt: string; phoneMasked: string; dispatch: { id: string; title: string; purpose: string }; contact: { name: string } }[];
}

export default function StudentDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'contacts' | 'anomalies' | 'frais' | 'messages'>('contacts');
  const q = useQuery({ queryKey: ['student', id], queryFn: () => api.get<Detail>(`/students/${id}`) });
  const classes = useQuery({ queryKey: ['classes'], queryFn: () => api.get<SchoolClass[]>('/classes') });
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState<Partial<Contact> | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['student', id] });

  const archive = useMutation({ mutationFn: () => api.del(`/students/${id}`), onSuccess: () => (toast('Élève archivé'), refresh()) });
  const erase = useMutation({ mutationFn: () => api.post(`/students/${id}/erase`), onSuccess: () => (toast('Données personnelles effacées'), refresh()) });
  const removeContact = useMutation({ mutationFn: (cid: string) => api.del(`/students/${id}/contacts/${cid}`), onSuccess: () => (toast('Contact retiré'), refresh()) });

  if (!q.data) return <Loading />;
  const s = q.data;
  const current = s.enrolments.find((e) => e.academicYear.isActive);
  return (
    <>
      <PageHeader
        title={`${s.lastName} ${s.firstName}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="tnum">{s.matricule}</span>· {current?.class.name ?? 'Non inscrit cette année'}
            {s.status !== 'ACTIVE' && <Badge>{STUDENT_STATUS[s.status]}</Badge>}
          </span>
        }
        actions={
          <>
            <Link to="/eleves">
              <Button variant="ghost">← Élèves</Button>
            </Link>
            <Button onClick={() => setEditing(true)}>Modifier</Button>
            <a href={`/api/v1/students/${id}/export`} download={`eleve-${s.matricule}.json`}>
              <Button variant="ghost">Exporter les données</Button>
            </a>
            {s.status === 'ACTIVE' && (
              <Button variant="ghost" onClick={() => confirm('Archiver cet élève ? Son historique est conservé.') && archive.mutate()}>
                Archiver
              </Button>
            )}
            <Button variant="danger" onClick={() => confirm('Effacer définitivement les données personnelles de cet élève et de ses parents ? L’historique des envois est conservé sans numéro.') && erase.mutate()}>
              Effacer
            </Button>
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'contacts', label: `Contacts (${s.contacts.length})` },
          { value: 'anomalies', label: `Absences et retards (${s.anomalies.length})` },
          { value: 'frais', label: 'Frais' },
          { value: 'messages', label: `Messages reçus (${s.messages.length})` },
        ]}
      />

      {tab === 'contacts' && (
        <Card title="Contacts des parents" actions={<Button size="sm" variant="primary" onClick={() => setContact({ name: '', relationship: '', phone: '', isOptedOut: false })}>Ajouter</Button>} padded={false}>
          {s.contacts.length === 0 ? (
            <Empty title="Aucun contact">Sans contact, l’élève ne peut recevoir aucun message.</Empty>
          ) : (
            <Table head={['Nom', 'Lien', 'WhatsApp', 'Consentement', '']}>
              {s.contacts.map((c) => (
                <tr key={c.id}>
                  <Td className="font-medium">
                    {c.name} {c.isOptedOut && <Badge tone="red">Désinscrit</Badge>}
                  </Td>
                  <Td>{c.relationship}</Td>
                  <Td className="tnum">{c.phone}</Td>
                  <Td className="tnum text-muted">{c.consentAt ? toDay(new Date(c.consentAt)).split('-').reverse().join('/') : '—'}</Td>
                  <Td className="whitespace-nowrap text-right">
                    <Button size="sm" variant="ghost" onClick={() => setContact(c)}>
                      Modifier
                    </Button>
                    <Button size="sm" variant="ghost" className="text-red-700" onClick={() => confirm('Retirer ce contact ?') && removeContact.mutate(c.id)}>
                      Retirer
                    </Button>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
          <div className="border-t border-line px-4 py-3 text-xs text-muted">
            Inscriptions :{' '}
            {s.enrolments.map((e) => `${e.academicYear.label} ${e.class.name}${e.outcome ? ` (${OUTCOME[e.outcome]})` : ''}`).join(' · ')}
          </div>
        </Card>
      )}

      {tab === 'anomalies' && (
        <Card padded={false}>
          {s.anomalies.length === 0 ? (
            <Empty title="Aucune anomalie" />
          ) : (
            <Table head={['Date', 'Type', 'Détail', 'Justifiée']}>
              {s.anomalies.map((a) => (
                <tr key={a.id}>
                  <Td className="tnum">{toDay(new Date(a.date)).split('-').reverse().join('/')}</Td>
                  <Td>
                    <Badge tone={a.type === 'ABSENCE' ? 'amber' : 'blue'}>{ANOMALY[a.type]}</Badge>
                  </Td>
                  <Td className="text-muted">{a.type === 'ABSENCE' ? a.subject?.name : `Arrivée ${a.arrivalTime?.replace(':', 'h')}`}</Td>
                  <Td>{a.isJustified ? 'Oui' : 'Non'}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === 'frais' && (
        <Card padded={false}>
          {s.fees.length === 0 ? (
            <Empty title="Aucune tranche définie" />
          ) : (
            <Table head={['Tranche', 'Échéance', 'Montant dû', 'Payé', 'Solde', 'Paiements']}>
              {s.fees.map((f) => (
                <tr key={f.id}>
                  <Td className="font-medium">
                    {f.installment.name} {f.isOverride && <Badge tone="blue">Montant individuel</Badge>}
                  </Td>
                  <Td className="tnum">{toDay(new Date(f.installment.dueDate)).split('-').reverse().join('/')}</Td>
                  <Td className="tnum">{xaf(f.amountDueXaf)}</Td>
                  <Td className="tnum">{xaf(f.paid)}</Td>
                  <Td className={`tnum font-medium ${f.balance > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{xaf(f.balance)}</Td>
                  <Td className="text-xs text-muted">
                    {f.payments.map((p) => (
                      <div key={p.id} className="tnum">
                        {toDay(new Date(p.paidOn)).split('-').reverse().join('/')} · {xaf(p.amountXaf)} {p.reference && `· ${p.reference}`}
                      </div>
                    ))}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === 'messages' && (
        <Card padded={false}>
          {s.messages.length === 0 ? (
            <Empty title="Aucun message envoyé" />
          ) : (
            <Table head={['Date', 'Envoi', 'Type', 'Parent', 'Statut']}>
              {s.messages.map((m) => (
                <tr key={m.id}>
                  <Td className="tnum whitespace-nowrap">{formatInstantFr(m.createdAt)}</Td>
                  <Td>
                    <Link to={`/historique/${m.dispatch.id}`} className="hover:underline">
                      {m.dispatch.title}
                    </Link>
                  </Td>
                  <Td>{PURPOSE[m.dispatch.purpose]}</Td>
                  <Td>
                    {m.contact.name} <span className="tnum text-xs text-muted">{m.phoneMasked}</span>
                  </Td>
                  <Td>
                    <Badge tone={statusTone(m.status)}>{MESSAGE_STATUS[m.status]}</Badge>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      <EditStudent open={editing} onClose={() => setEditing(false)} student={s} currentClassId={current?.class.id ?? ''} classes={classes.data ?? []} onSaved={refresh} />
      <ContactModal studentId={s.id} contact={contact} onClose={() => setContact(null)} onSaved={refresh} />
    </>
  );
}

function EditStudent({ open, onClose, student, currentClassId, classes, onSaved }: { open: boolean; onClose: () => void; student: Detail; currentClassId: string; classes: SchoolClass[]; onSaved: () => void }) {
  const [f, setF] = useState({ matricule: student.matricule, lastName: student.lastName, firstName: student.firstName, classId: currentClassId, status: student.status });
  const save = useMutation({
    mutationFn: () => api.patch(`/students/${student.id}`, { ...f, classId: f.classId || undefined }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Modifier l’élève"
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Matricule">
          <Input value={f.matricule} onChange={(e) => setF({ ...f, matricule: e.target.value })} />
        </Field>
        <Field label="Classe (année active)">
          <Select value={f.classId} onChange={(e) => setF({ ...f, classId: e.target.value })}>
            <option value="">—</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nom">
          <Input value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />
        </Field>
        <Field label="Prénom">
          <Input value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} />
        </Field>
        <Field label="Statut">
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            {Object.entries(STUDENT_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-3">
        <ErrorNote error={save.error} />
      </div>
    </Modal>
  );
}

function ContactModal({ studentId, contact, onClose, onSaved }: { studentId: string; contact: Partial<Contact> | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Partial<Contact>>({});
  const [lastId, setLastId] = useState<string | undefined>('none');
  if (contact && (contact.id ?? 'new') !== lastId) {
    setLastId(contact.id ?? 'new');
    setF(contact);
  }
  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name, relationship: f.relationship ?? '', phone: f.phone, isOptedOut: !!f.isOptedOut };
      return contact?.id ? api.patch(`/students/${studentId}/contacts/${contact.id}`, body) : api.post(`/students/${studentId}/contacts`, body);
    },
    onSuccess: () => {
      onSaved();
      setLastId('none');
      onClose();
    },
  });
  return (
    <Modal
      open={!!contact}
      onClose={() => (setLastId('none'), onClose())}
      title={contact?.id ? 'Modifier le contact' : 'Ajouter un contact'}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.name || !f.phone} onClick={() => save.mutate()}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nom">
            <Input value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
          </Field>
          <Field label="Lien">
            <Input value={f.relationship ?? ''} onChange={(e) => setF({ ...f, relationship: e.target.value })} placeholder="Mère, Père, Tuteur…" />
          </Field>
        </div>
        <Field label="Numéro WhatsApp" hint="Normalisé automatiquement au format +237…">
          <Input value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" />
        </Field>
        <Checkbox checked={!!f.isOptedOut} onChange={(v) => setF({ ...f, isOptedOut: v })} label="Ne plus envoyer de messages à ce contact (désinscrit)" />
        <ErrorNote error={save.error} />
      </div>
    </Modal>
  );
}
