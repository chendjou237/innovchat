import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Badge, Button, Card, Empty, ErrorNote, Loading, PageHeader, Table, Tabs, Td, useToast } from '../components/ui';
import { api, fileUrl } from '../lib/api';

interface PreviewRow {
  row: number;
  action: 'create' | 'update' | 'error';
  data: Record<string, string>;
  errors: string[];
}
interface Job {
  id: string;
  kind: 'STUDENTS' | 'PAYMENTS';
  fileName: string;
  status: 'PREVIEW' | 'COMMITTED' | 'CANCELLED';
  rowsTotal: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsFailed: number;
  createdAt: string;
  rows: PreviewRow[];
}

const COLS: Record<Job['kind'], [string, string][]> = {
  STUDENTS: [
    ['matricule', 'Matricule'],
    ['last_name', 'Nom'],
    ['first_name', 'Prénom'],
    ['class', 'Classe'],
    ['p1_name', 'Parent 1'],
    ['p1_phone', 'Téléphone 1'],
    ['p2_name', 'Parent 2'],
    ['p2_phone', 'Téléphone 2'],
  ],
  PAYMENTS: [
    ['matricule', 'Matricule'],
    ['installment', 'Tranche'],
    ['amount', 'Montant'],
    ['paid_on', 'Date'],
    ['reference', 'Référence'],
  ],
};

/** Import Excel/CSV: template, upload, three-tab preview, commit, error rows (FR-IMP, UC-05). */
export default function ImportPage() {
  const { id } = useParams();
  return id ? <JobView id={id} /> : <Upload />;
}

function Upload() {
  const nav = useNavigate();
  const [kind, setKind] = useState<Job['kind']>('STUDENTS');
  const [file, setFile] = useState<File | null>(null);
  const history = useQuery({ queryKey: ['imports'], queryFn: () => api.get<Omit<Job, 'rows'>[]>('/imports') });
  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('kind', kind);
      fd.append('file', file!);
      return api.upload<Job>('/imports', fd);
    },
    onSuccess: (j) => nav(`/import/${j.id}`),
  });

  return (
    <>
      <PageHeader title="Import" description="Importez les élèves et leurs parents, ou les paiements, depuis un fichier Excel (.xlsx) ou CSV de 5 000 lignes au plus. Le fichier est entièrement vérifié avant tout enregistrement." />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card title="Nouveau fichier">
          <Tabs
            value={kind}
            onChange={setKind}
            items={[
              { value: 'STUDENTS', label: 'Élèves et parents' },
              { value: 'PAYMENTS', label: 'Paiements' },
            ]}
          />
          <ol className="space-y-4 text-sm">
            <li>
              <div className="font-medium">1. Téléchargez le modèle</div>
              <p className="mb-2 text-muted">
                {kind === 'STUDENTS'
                  ? 'Colonnes : matricule, nom, prénom, classe, puis nom, lien et téléphone de deux parents.'
                  : 'Colonnes : matricule, tranche, montant (FCFA), date de paiement, référence.'}
              </p>
              <a href={fileUrl(`/imports/template?kind=${kind}`)}>
                <Button size="sm">Télécharger le modèle Excel</Button>
              </a>
            </li>
            <li>
              <div className="mb-2 font-medium">2. Déposez le fichier rempli</div>
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-line bg-stone-50 px-4 py-8 text-center hover:border-brand-500">
                <input type="file" accept=".xlsx,.csv" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <span className="text-sm font-medium">{file ? file.name : 'Choisir un fichier .xlsx ou .csv'}</span>
                <span className="mt-1 text-xs text-muted">{file ? `${Math.round(file.size / 1024)} Ko` : 'Cliquez pour parcourir'}</span>
              </label>
            </li>
          </ol>
          <div className="mt-4 flex items-center justify-between gap-3">
            <ErrorNote error={upload.error} />
            <Button variant="primary" className="ml-auto" disabled={!file} loading={upload.isPending} onClick={() => upload.mutate()}>
              Vérifier le fichier
            </Button>
          </div>
        </Card>
        <Card title="Imports récents" padded={false}>
          {!history.data?.length ? (
            <Empty title="Aucun import" />
          ) : (
            <ul className="divide-y divide-line">
              {history.data.map((j) => (
                <li key={j.id}>
                  <Link to={`/import/${j.id}`} className="block px-4 py-2.5 text-sm hover:bg-stone-50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{j.fileName}</span>
                      <Badge tone={j.status === 'COMMITTED' ? 'green' : j.status === 'PREVIEW' ? 'amber' : 'neutral'}>
                        {j.status === 'COMMITTED' ? 'Importé' : j.status === 'PREVIEW' ? 'À valider' : 'Annulé'}
                      </Badge>
                    </div>
                    <div className="tnum text-xs text-muted">
                      {j.kind === 'STUDENTS' ? 'Élèves' : 'Paiements'} · {new Date(j.createdAt).toLocaleDateString('fr-FR')} · {j.rowsCreated} créés · {j.rowsUpdated} m. à j. · {j.rowsFailed} erreurs
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function JobView({ id }: { id: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['import', id], queryFn: () => api.get<Job>(`/imports/${id}`) });
  const [tab, setTab] = useState<PreviewRow['action']>('create');
  const commit = useMutation({
    mutationFn: () => api.post<Job>(`/imports/${id}/commit`),
    onSuccess: (j) => {
      qc.setQueryData(['import', id], j);
      void qc.invalidateQueries({ queryKey: ['imports'] });
      void qc.invalidateQueries({ queryKey: ['students'] });
      toast('Import terminé');
    },
  });
  const cancel = useMutation({ mutationFn: () => api.post(`/imports/${id}/cancel`), onSuccess: () => nav('/import') });

  if (q.isLoading || !q.data) return <Loading />;
  const j = q.data;
  const rows = j.rows.filter((r) => r.action === tab);
  const valid = j.rows.filter((r) => r.action !== 'error').length;
  const cols = COLS[j.kind];

  return (
    <>
      <PageHeader
        title={j.fileName}
        description={j.kind === 'STUDENTS' ? 'Import des élèves et parents' : 'Import des paiements'}
        actions={
          <>
            <Link to="/import">
              <Button variant="ghost">← Import</Button>
            </Link>
            {j.rowsFailed > 0 && (
              <a href={fileUrl(`/imports/${id}/errors`)}>
                <Button>Télécharger les {j.rowsFailed} lignes en erreur</Button>
              </a>
            )}
            {j.status === 'PREVIEW' && (
              <>
                <Button variant="ghost" onClick={() => cancel.mutate()}>
                  Annuler
                </Button>
                <Button variant="primary" disabled={valid === 0} loading={commit.isPending} onClick={() => commit.mutate()}>
                  Importer les {valid} lignes valides
                </Button>
              </>
            )}
          </>
        }
      />
      {j.status === 'COMMITTED' && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Import terminé : {j.rowsCreated} créé(s), {j.rowsUpdated} mis à jour. {j.rowsFailed > 0 && `${j.rowsFailed} ligne(s) ignorée(s) : téléchargez-les, corrigez-les et importez-les à nouveau.`}
        </div>
      )}
      {j.status === 'CANCELLED' && <div className="mb-4 rounded-lg border border-line bg-stone-50 px-4 py-3 text-sm">Import annulé : rien n’a été enregistré.</div>}
      <ErrorNote error={commit.error} />
      <Card padded={false}>
        <div className="px-4 pt-3">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { value: 'create', label: `À créer (${j.rows.filter((r) => r.action === 'create').length})` },
              ...(j.kind === 'STUDENTS' ? [{ value: 'update' as const, label: `À mettre à jour (${j.rows.filter((r) => r.action === 'update').length})` }] : []),
              { value: 'error', label: <span className={j.rowsFailed ? 'text-red-700' : ''}>Erreurs ({j.rowsFailed})</span> },
            ]}
          />
        </div>
        {rows.length === 0 ? (
          <Empty title="Aucune ligne" />
        ) : (
          <Table head={['Ligne', ...cols.map((c) => c[1]), ...(tab === 'error' ? ['Erreur'] : [])]}>
            {rows.slice(0, 500).map((r) => (
              <tr key={r.row} className={tab === 'error' ? 'bg-red-50/40' : ''}>
                <Td className="tnum text-muted">{r.row}</Td>
                {cols.map(([k]) => (
                  <Td key={k} className="whitespace-nowrap">
                    {r.data[k]}
                  </Td>
                ))}
                {tab === 'error' && <Td className="text-red-800">{r.errors.join(' ; ')}</Td>}
              </tr>
            ))}
          </Table>
        )}
        {rows.length > 500 && <div className="border-t border-line px-4 py-2 text-xs text-muted">500 premières lignes affichées sur {rows.length}.</div>}
      </Card>
    </>
  );
}
