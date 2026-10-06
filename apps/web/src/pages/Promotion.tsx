import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, Loading, PageHeader, Select, Table, Td, useToast } from '../components/ui';
import { api } from '../lib/api';
import { OUTCOME } from '../lib/fr';

interface PreviewData {
  current_year: { id: string; label: string; start_date: string; end_date: string };
  classes: { id: string; name: string; level: string; department: string; students: { id: string; name: string; matricule: string }[] }[];
  summary: { next_classes: Record<string, { promoted: number; repeating: number }>; leaving: number; unmapped: string[] };
}
const LEAVING = '__leaving__';

/** Passage en classe supérieure: class mapping, per-student outcomes, summary and confirm (FR-PRO). */
export default function Promotion() {
  const qc = useQueryClient();
  const toast = useToast();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [year, setYear] = useState({ label: '', startDate: '', endDate: '' });
  const [map, setMap] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<Record<string, 'PROMOTED' | 'REPEATING' | 'LEFT'>>({});
  const body = {
    next_year: year,
    class_map: Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v === LEAVING ? null : v])),
    outcomes,
  };
  const preview = useQuery({ queryKey: ['promotion', JSON.stringify(body)], queryFn: () => api.post<PreviewData>('/promotions/preview', body), placeholderData: (p) => p });

  useEffect(() => {
    const p = preview.data;
    if (!p || year.label) return;
    const [a, b] = p.current_year.label.split(/[-/]/).map(Number);
    if (a && b) setYear({ label: `${a + 1}-${b + 1}`, startDate: `${a + 1}-09-01`, endDate: `${b + 1}-06-30` });
  }, [preview.data, year.label]);

  const commit = useMutation({
    mutationFn: () => api.post<{ counts: Record<string, number> }>('/promotions/commit', body),
    onSuccess: (r) => {
      toast(`Passage effectué : ${r.counts.PROMOTED} admis, ${r.counts.REPEATING} redoublants, ${r.counts.LEFT} départs`);
      void qc.invalidateQueries();
      setStep(1);
      setMap({});
      setOutcomes({});
      setYear({ label: '', startDate: '', endDate: '' });
    },
  });

  if (!preview.data) return <Loading />;
  const p = preview.data;
  const names = p.classes.map((c) => c.name);
  const allMapped = p.classes.every((c) => map[c.id]);

  return (
    <>
      <PageHeader
        title="Passage en classe supérieure"
        description={`Fin de l’année ${p.current_year.label} : crée l’année suivante avec les mêmes classes, inscrit chaque élève selon son résultat et rend la nouvelle année active. L’historique reste attaché à l’année précédente.`}
      />
      <div className="mb-4 flex gap-2 text-sm">
        {['Correspondance des classes', 'Résultats par élève', 'Récapitulatif'].map((l, i) => (
          <button key={l} onClick={() => (i === 0 || allMapped) && setStep((i + 1) as 1 | 2 | 3)} className={`rounded-full px-3 py-1 ${step === i + 1 ? 'bg-ink text-white' : 'bg-white text-muted ring-1 ring-line'}`}>
            {i + 1}. {l}
          </button>
        ))}
      </div>

      {step === 1 && (
        <Card title="Nouvelle année et correspondance des classes">
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Field label="Nouvelle année">
              <Input value={year.label} onChange={(e) => setYear({ ...year, label: e.target.value })} />
            </Field>
            <Field label="Début">
              <Input type="date" value={year.startDate} onChange={(e) => setYear({ ...year, startDate: e.target.value })} />
            </Field>
            <Field label="Fin">
              <Input type="date" value={year.endDate} onChange={(e) => setYear({ ...year, endDate: e.target.value })} />
            </Field>
          </div>
          <Table head={['Classe actuelle', 'Élèves', 'Classe l’an prochain']}>
            {p.classes.map((c) => (
              <tr key={c.id}>
                <Td className="font-medium">
                  {c.name} <span className="text-xs text-muted">{c.department}</span>
                </Td>
                <Td className="tnum">{c.students.length}</Td>
                <Td>
                  <Select value={map[c.id] ?? ''} onChange={(e) => setMap({ ...map, [c.id]: e.target.value })} className="w-56">
                    <option value="">— Choisir —</option>
                    {names.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                    <option value={LEAVING}>Quitte l’école (fin de cycle)</option>
                  </Select>
                </Td>
              </tr>
            ))}
          </Table>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" disabled={!allMapped || !year.label || !year.startDate || !year.endDate} onClick={() => setStep(2)}>
              Continuer
            </Button>
          </div>
        </Card>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="text-sm text-muted">Par défaut, chaque élève est admis. Indiquez les redoublants et les départs.</p>
          {p.classes.map((c) => (
            <Card key={c.id} title={`${c.name} → ${map[c.id] === LEAVING ? 'Quitte l’école' : map[c.id]}`} padded={false}>
              <ul className="grid gap-px bg-line sm:grid-cols-2">
                {c.students.map((s) => {
                  const def = map[c.id] === LEAVING ? 'LEFT' : 'PROMOTED';
                  const v = outcomes[s.id] ?? def;
                  return (
                    <li key={s.id} className="flex items-center justify-between gap-2 bg-white px-4 py-1.5 text-sm">
                      <span>
                        {s.name} <span className="text-xs text-muted">{s.matricule}</span>
                      </span>
                      <Select
                        value={v}
                        className="h-8 w-40 text-[13px]"
                        onChange={(e) => {
                          const val = e.target.value as 'PROMOTED' | 'REPEATING' | 'LEFT';
                          setOutcomes((o) => {
                            const n = { ...o };
                            if (val === def) delete n[s.id];
                            else n[s.id] = val;
                            return n;
                          });
                        }}
                      >
                        {Object.entries(OUTCOME).map(([k, l]) => (
                          <option key={k} value={k}>
                            {l}
                          </option>
                        ))}
                      </Select>
                    </li>
                  );
                })}
                {c.students.length === 0 && <li className="bg-white px-4 py-2 text-sm text-muted">Aucun élève</li>}
              </ul>
            </Card>
          ))}
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setStep(3)}>
              Voir le récapitulatif
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <Card title={`Récapitulatif — ${year.label}`}>
          <Table head={['Classe', 'Admis', 'Redoublants', 'Total']}>
            {Object.entries(p.summary.next_classes)
              .sort()
              .map(([name, v]) => (
                <tr key={name}>
                  <Td className="font-medium">{name}</Td>
                  <Td className="tnum">{v.promoted}</Td>
                  <Td className="tnum">{v.repeating}</Td>
                  <Td className="tnum">{v.promoted + v.repeating}</Td>
                </tr>
              ))}
          </Table>
          <div className="mt-3 text-sm">
            <Badge tone="amber">{p.summary.leaving} départ(s)</Badge>
          </div>
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {year.label} deviendra l’année active. Les absences, frais et messages restent consultables sur l’année {p.current_year.label}.
          </div>
          <div className="mt-3">
            <ErrorNote error={commit.error} />
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" loading={commit.isPending} onClick={() => confirm(`Confirmer le passage vers ${year.label} ?`) && commit.mutate()}>
              Confirmer le passage
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}
