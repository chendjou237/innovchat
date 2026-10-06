import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, ReactNode, useState } from 'react';
import { Badge, Button, Card, Checkbox, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Select, Table, Tabs, Td, useToast } from '../components/ui';
import { api } from '../lib/api';
import type { Department, SchoolClass, Subject, Year } from '../lib/types';

type Tab = 'annees' | 'departements' | 'classes' | 'matieres';

/** Années, départements, classes, matières (FR-ORG-001..004). */
export default function Structure() {
  const [tab, setTab] = useState<Tab>('classes');
  return (
    <>
      <PageHeader title="Structure de l’école" description="Années scolaires, départements, classes de l’année active et matières utilisées pour les absences." />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'annees', label: 'Années' },
          { value: 'departements', label: 'Départements' },
          { value: 'classes', label: 'Classes' },
          { value: 'matieres', label: 'Matières' },
        ]}
      />
      {tab === 'annees' && <Years />}
      {tab === 'departements' && <Departments />}
      {tab === 'classes' && <Classes />}
      {tab === 'matieres' && <Subjects />}
    </>
  );
}

function useCrud(key: string, base: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const done = (msg: string) => () => {
    toast(msg);
    void qc.invalidateQueries({ queryKey: [key] });
    void qc.invalidateQueries({ queryKey: ['recipients-tree'] });
    void qc.invalidateQueries({ queryKey: ['years'] });
  };
  const onError = (e: unknown) => toast((e as Error).message, 'error');
  return {
    create: useMutation({ mutationFn: (body: unknown) => api.post(base, body), onSuccess: done('Ajouté'), onError }),
    update: useMutation({ mutationFn: ({ id, body }: { id: string; body: unknown }) => api.patch(`${base}/${id}`, body), onSuccess: done('Enregistré'), onError }),
    remove: useMutation({ mutationFn: (id: string) => api.del(`${base}/${id}`), onSuccess: done('Supprimé'), onError }),
  };
}

function EditModal({ open, onClose, title, onSubmit, busy, error, children }: { open: boolean; onClose: () => void; title: string; onSubmit: () => void; busy: boolean; error: unknown; children: ReactNode }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit();
        }}
        className="space-y-3"
      >
        {children}
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Annuler</Button>
          <Button type="submit" variant="primary" loading={busy}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Years() {
  const q = useQuery({ queryKey: ['years'], queryFn: () => api.get<Year[]>('/academic-years') });
  const crud = useCrud('years', '/academic-years');
  const qc = useQueryClient();
  const activate = useMutation({ mutationFn: (id: string) => api.post(`/academic-years/${id}/activate`), onSuccess: () => qc.invalidateQueries() });
  const [edit, setEdit] = useState<Partial<Year> | null>(null);
  const [form, setForm] = useState({ label: '', startDate: '', endDate: '' });
  const open = (y: Partial<Year>) => {
    setEdit(y);
    setForm({ label: y.label ?? '', startDate: y.startDate?.slice(0, 10) ?? '', endDate: y.endDate?.slice(0, 10) ?? '' });
  };
  const m = edit?.id ? crud.update : crud.create;
  return (
    <Card title="Années scolaires" actions={<Button size="sm" variant="primary" onClick={() => open({})}>Ajouter</Button>} padded={false}>
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.length ? (
        <Empty title="Aucune année">Créez l’année en cours (ex. 2026-2027) ; la première année créée devient active.</Empty>
      ) : (
        <Table head={['Année', 'Début', 'Fin', 'Classes', 'Élèves', '']}>
          {q.data.map((y) => (
            <tr key={y.id}>
              <Td className="font-medium">
                {y.label} {y.isActive && <Badge tone="green">Active</Badge>}
              </Td>
              <Td className="tnum">{y.startDate.slice(0, 10).split('-').reverse().join('/')}</Td>
              <Td className="tnum">{y.endDate.slice(0, 10).split('-').reverse().join('/')}</Td>
              <Td className="tnum">{y._count?.classes}</Td>
              <Td className="tnum">{y._count?.enrolments}</Td>
              <Td className="whitespace-nowrap text-right">
                {!y.isActive && (
                  <Button size="sm" variant="ghost" onClick={() => confirm(`Rendre ${y.label} active ? Préférez le « Passage en classe supérieure » en fin d’année.`) && activate.mutate(y.id)}>
                    Activer
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => open(y)}>
                  Modifier
                </Button>
                {!y.isActive && (
                  <Button size="sm" variant="ghost" className="text-red-700" onClick={() => confirm('Supprimer cette année ?') && crud.remove.mutate(y.id)}>
                    Supprimer
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <EditModal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Modifier l’année' : 'Nouvelle année scolaire'}
        busy={m.isPending}
        error={m.error}
        onSubmit={() => (edit?.id ? crud.update.mutate({ id: edit.id, body: form }, { onSuccess: () => setEdit(null) }) : crud.create.mutate(form, { onSuccess: () => setEdit(null) }))}
      >
        <Field label="Libellé">
          <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="2026-2027" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Début">
            <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
          </Field>
          <Field label="Fin">
            <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required />
          </Field>
        </div>
      </EditModal>
    </Card>
  );
}

function Departments() {
  const q = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/departments') });
  const crud = useCrud('departments', '/departments');
  const [edit, setEdit] = useState<Partial<Department> | null>(null);
  const [name, setName] = useState('');
  const m = edit?.id ? crud.update : crud.create;
  return (
    <Card
      title="Départements"
      actions={
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            setEdit({});
            setName('');
          }}
        >
          Ajouter
        </Button>
      }
      padded={false}
    >
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.length ? (
        <Empty title="Aucun département">Ex. « Premier cycle », « Second cycle ».</Empty>
      ) : (
        <Table head={['Nom', 'Classes (année active)', '']}>
          {q.data.map((d) => (
            <tr key={d.id}>
              <Td className="font-medium">{d.name}</Td>
              <Td className="tnum">{d._count?.classes}</Td>
              <Td className="whitespace-nowrap text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEdit(d);
                    setName(d.name);
                  }}
                >
                  Renommer
                </Button>
                <Button size="sm" variant="ghost" className="text-red-700" disabled={!!d._count?.classes} title={d._count?.classes ? 'Un département qui contient des classes ne peut pas être supprimé' : ''} onClick={() => confirm('Supprimer ce département ?') && crud.remove.mutate(d.id)}>
                  Supprimer
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <EditModal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Renommer le département' : 'Nouveau département'}
        busy={m.isPending}
        error={m.error}
        onSubmit={() => (edit?.id ? crud.update.mutate({ id: edit.id, body: { name } }, { onSuccess: () => setEdit(null) }) : crud.create.mutate({ name }, { onSuccess: () => setEdit(null) }))}
      >
        <Field label="Nom">
          <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </Field>
      </EditModal>
    </Card>
  );
}

function Classes() {
  const q = useQuery({ queryKey: ['classes'], queryFn: () => api.get<SchoolClass[]>('/classes') });
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/departments') });
  const crud = useCrud('classes', '/classes');
  const [edit, setEdit] = useState<Partial<SchoolClass> | null>(null);
  const [form, setForm] = useState({ name: '', level: '', departmentId: '' });
  const m = edit?.id ? crud.update : crud.create;
  const open = (c: Partial<SchoolClass>) => {
    setEdit(c);
    setForm({ name: c.name ?? '', level: c.level ?? '', departmentId: c.departmentId ?? depts.data?.[0]?.id ?? '' });
  };
  return (
    <Card title="Classes de l’année active" actions={<Button size="sm" variant="primary" onClick={() => open({})} disabled={!depts.data?.length}>Ajouter</Button>} padded={false}>
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.length ? (
        <Empty title="Aucune classe">{depts.data?.length ? 'Ajoutez les classes de l’année active.' : 'Créez d’abord un département.'}</Empty>
      ) : (
        <Table head={['Classe', 'Niveau', 'Département', 'Élèves', '']}>
          {q.data.map((c) => (
            <tr key={c.id}>
              <Td className="font-medium">{c.name}</Td>
              <Td>{c.level}</Td>
              <Td>{c.department?.name}</Td>
              <Td className="tnum">{c._count?.enrolments}</Td>
              <Td className="whitespace-nowrap text-right">
                <Button size="sm" variant="ghost" onClick={() => open(c)}>
                  Modifier
                </Button>
                <Button size="sm" variant="ghost" className="text-red-700" disabled={!!c._count?.enrolments} onClick={() => confirm('Supprimer cette classe ?') && crud.remove.mutate(c.id)}>
                  Supprimer
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <EditModal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Modifier la classe' : 'Nouvelle classe'}
        busy={m.isPending}
        error={m.error}
        onSubmit={() => (edit?.id ? crud.update.mutate({ id: edit.id, body: form }, { onSuccess: () => setEdit(null) }) : crud.create.mutate(form, { onSuccess: () => setEdit(null) }))}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nom">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="6e A" required autoFocus />
          </Field>
          <Field label="Niveau">
            <Input value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} placeholder="6e" />
          </Field>
        </div>
        <Field label="Département">
          <Select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
            {depts.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
      </EditModal>
    </Card>
  );
}

function Subjects() {
  const q = useQuery({ queryKey: ['subjects'], queryFn: () => api.get<Subject[]>('/subjects') });
  const crud = useCrud('subjects', '/subjects');
  const [edit, setEdit] = useState<Partial<Subject> | null>(null);
  const [form, setForm] = useState({ name: '', isActive: true });
  const m = edit?.id ? crud.update : crud.create;
  return (
    <Card
      title="Matières"
      actions={
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            setEdit({});
            setForm({ name: '', isActive: true });
          }}
        >
          Ajouter
        </Button>
      }
      padded={false}
    >
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.length ? (
        <Empty title="Aucune matière">Ex. Mathématiques, Français…</Empty>
      ) : (
        <Table head={['Matière', 'Statut', '']}>
          {q.data.map((s) => (
            <tr key={s.id}>
              <Td className="font-medium">{s.name}</Td>
              <Td>{s.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
              <Td className="whitespace-nowrap text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEdit(s);
                    setForm({ name: s.name, isActive: s.isActive });
                  }}
                >
                  Modifier
                </Button>
                <Button size="sm" variant="ghost" className="text-red-700" onClick={() => confirm('Supprimer cette matière ? Si elle est utilisée, elle sera désactivée.') && crud.remove.mutate(s.id)}>
                  Supprimer
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <EditModal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Modifier la matière' : 'Nouvelle matière'}
        busy={m.isPending}
        error={m.error}
        onSubmit={() => (edit?.id ? crud.update.mutate({ id: edit.id, body: form }, { onSuccess: () => setEdit(null) }) : crud.create.mutate(form, { onSuccess: () => setEdit(null) }))}
      >
        <Field label="Nom">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
        </Field>
        <Checkbox checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label="Active" />
      </EditModal>
    </Card>
  );
}
