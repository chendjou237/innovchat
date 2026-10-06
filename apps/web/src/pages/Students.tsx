import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Pager, Select, Table, Td } from '../components/ui';
import { api, qs } from '../lib/api';
import { STUDENT_STATUS } from '../lib/fr';
import type { Paged, SchoolClass } from '../lib/types';

interface Row {
  id: string;
  matricule: string;
  firstName: string;
  lastName: string;
  status: string;
  class: { id: string; name: string } | null;
  contacts: { id: string; name: string; relationship: string; phoneMasked: string; isOptedOut: boolean }[];
}

/** Élèves: searchable by name, matricule, class and parent phone (FR-STU-005). */
export default function Students() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const classId = params.get('class_id') ?? '';
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? 1);
  const classes = useQuery({ queryKey: ['classes'], queryFn: () => api.get<SchoolClass[]>('/classes') });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      if (q !== (params.get('q') ?? '')) setParams((p) => (q ? (p.set('q', q), p.delete('page'), p) : (p.delete('q'), p)));
    }, 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useQuery({
    queryKey: ['students', params.toString()],
    queryFn: () => api.get<Paged<Row>>(`/students${qs({ q: params.get('q'), class_id: classId, status, page, page_size: 50 })}`),
    placeholderData: (p) => p,
  });
  const setParam = (k: string, v: string) =>
    setParams((p) => {
      if (v) p.set(k, v);
      else p.delete(k);
      p.delete('page');
      return p;
    });

  return (
    <>
      <PageHeader
        title="Élèves"
        description="Recherche par nom, matricule, classe ou numéro de téléphone d’un parent."
        actions={
          <>
            <Link to="/import">
              <Button>Importer (Excel)</Button>
            </Link>
            <Button variant="primary" onClick={() => setCreating(true)}>
              Ajouter un élève
            </Button>
          </>
        }
      />
      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <Field label="Recherche" className="min-w-64 flex-1">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, matricule, classe ou 6XX XX XX XX" />
          </Field>
          <Field label="Classe" className="w-40">
            <Select value={classId} onChange={(e) => setParam('class_id', e.target.value)}>
              <option value="">Toutes</option>
              {classes.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Statut" className="w-36">
            <Select value={status} onChange={(e) => setParam('status', e.target.value)}>
              <option value="">Actifs</option>
              <option value="LEFT">Partis</option>
              <option value="ARCHIVED">Archivés</option>
              <option value="ALL">Tous</option>
            </Select>
          </Field>
        </div>
        {list.isLoading ? (
          <Loading />
        ) : !list.data?.items.length ? (
          <Empty title="Aucun élève trouvé" />
        ) : (
          <>
            <Table head={['Élève', 'Matricule', 'Classe', 'Contacts parents', '']}>
              {list.data.items.map((s) => (
                <tr key={s.id} className="hover:bg-stone-50">
                  <Td>
                    <Link to={`/eleves/${s.id}`} className="font-medium hover:underline">
                      {s.lastName} {s.firstName}
                    </Link>
                  </Td>
                  <Td className="tnum text-muted">{s.matricule}</Td>
                  <Td>{s.class?.name ?? '—'}</Td>
                  <Td>
                    {s.contacts.length === 0 ? (
                      <Badge tone="amber">Aucun contact</Badge>
                    ) : (
                      <div className="space-y-0.5 text-[13px]">
                        {s.contacts.map((c) => (
                          <div key={c.id} className={c.isOptedOut ? 'text-muted line-through' : ''}>
                            {c.name} <span className="tnum text-muted">{c.phoneMasked}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Td>
                  <Td>{s.status !== 'ACTIVE' && <Badge>{STUDENT_STATUS[s.status]}</Badge>}</Td>
                </tr>
              ))}
            </Table>
            <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => setParams((x) => (x.set('page', String(p)), x))} />
          </>
        )}
      </Card>
      <CreateStudent open={creating} onClose={() => setCreating(false)} classes={classes.data ?? []} />
    </>
  );
}

function CreateStudent({ open, onClose, classes }: { open: boolean; onClose: () => void; classes: SchoolClass[] }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const blank = { matricule: '', lastName: '', firstName: '', classId: '', p1name: '', p1rel: 'Mère', p1phone: '', p2name: '', p2rel: 'Père', p2phone: '' };
  const [f, setF] = useState(blank);
  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/students', {
        matricule: f.matricule,
        lastName: f.lastName,
        firstName: f.firstName,
        classId: f.classId,
        contacts: [
          ...(f.p1phone ? [{ name: f.p1name || 'Parent 1', relationship: f.p1rel, phone: f.p1phone }] : []),
          ...(f.p2phone ? [{ name: f.p2name || 'Parent 2', relationship: f.p2rel, phone: f.p2phone }] : []),
        ],
      }),
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: ['students'] });
      setF(blank);
      onClose();
      nav(`/eleves/${s.id}`);
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ajouter un élève"
      wide
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={create.isPending} disabled={!f.matricule || !f.lastName || !f.firstName || !f.classId} onClick={() => create.mutate()}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Matricule">
          <Input value={f.matricule} onChange={(e) => setF({ ...f, matricule: e.target.value })} autoFocus />
        </Field>
        <Field label="Nom">
          <Input value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />
        </Field>
        <Field label="Prénom">
          <Input value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} />
        </Field>
        <Field label="Classe">
          <Select value={f.classId} onChange={(e) => setF({ ...f, classId: e.target.value })}>
            <option value="">—</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {(['p1', 'p2'] as const).map((p, i) => (
        <div key={p} className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label={`Parent ${i + 1} — nom`}>
            <Input value={f[`${p}name`]} onChange={(e) => setF({ ...f, [`${p}name`]: e.target.value })} />
          </Field>
          <Field label="Lien">
            <Input value={f[`${p}rel`]} onChange={(e) => setF({ ...f, [`${p}rel`]: e.target.value })} />
          </Field>
          <Field label="WhatsApp" hint={i === 0 ? '6XX XX XX XX ou +237…' : undefined}>
            <Input value={f[`${p}phone`]} onChange={(e) => setF({ ...f, [`${p}phone`]: e.target.value })} inputMode="tel" />
          </Field>
        </div>
      ))}
      <p className="mt-3 text-xs text-muted">Le consentement du parent à recevoir des messages WhatsApp est enregistré à la date du jour.</p>
      <div className="mt-3">
        <ErrorNote error={create.error} />
      </div>
    </Modal>
  );
}
