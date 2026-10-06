import { RecipientFilter } from '@innovcare/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, qs } from '../lib/api';
import { plural } from '../lib/fr';
import type { Paged, Preview } from '../lib/types';
import { Badge, Checkbox, Input, Spinner, cx, xaf } from './ui';

interface Tree {
  year: { id: string; label: string } | null;
  departments: { id: string; name: string; classes: { id: string; name: string; students: number }[] }[];
}
interface StudentRow {
  id: string;
  matricule: string;
  firstName: string;
  lastName: string;
  class: { id: string; name: string } | null;
  contacts: { phoneMasked: string; isOptedOut: boolean }[];
}

export const emptyFilter = (): RecipientFilter => ({
  whole_school: false,
  department_ids: [],
  class_ids: [],
  student_ids: [],
  exclude_student_ids: [],
  fee_installment_unpaid: null,
});

const toggle = (list: string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Live preview of a filter: students, messages, students without contact, estimated cost. */
export function usePreview(templateId: string | undefined, filter: RecipientFilter, parameters: Record<string, string> = {}) {
  const key = useDebounced(JSON.stringify({ templateId, filter, parameters }), 350);
  return useQuery({
    queryKey: ['preview', key],
    enabled: !!templateId,
    placeholderData: (prev) => prev,
    queryFn: () => api.post<Preview>('/dispatches/preview', { template_id: templateId, parameters, recipients_filter: filter }),
  });
}

/**
 * Recipient selector shared by Nouvel envoi, Calendrier and Frais scolaires (§9.1):
 * tree on the left (school → departments → classes → students), search across classes,
 * "Selected" panel on the right with exclusions, live summary underneath.
 */
export default function RecipientSelector({
  value,
  onChange,
  templateId,
  parameters,
  unpaidLabel,
}: {
  value: RecipientFilter;
  onChange: (f: RecipientFilter) => void;
  templateId?: string;
  parameters?: Record<string, string>;
  /** Shown when the filter is restricted to unpaid balances. */
  unpaidLabel?: string;
}) {
  const tree = useQuery({ queryKey: ['recipients-tree'], queryFn: () => api.get<Tree>('/recipients/tree') });
  const preview = usePreview(templateId, value, parameters);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 250);
  const results = useQuery({
    queryKey: ['student-search', q],
    enabled: q.length >= 2,
    queryFn: () => api.get<Paged<StudentRow>>(`/students${qs({ q, page_size: 12 })}`),
  });

  const set = (patch: Partial<RecipientFilter>) => onChange({ ...value, ...patch });
  const excluded = new Set(value.exclude_student_ids);
  const deptOfClass = useMemo(() => {
    const m = new Map<string, string>();
    tree.data?.departments.forEach((d) => d.classes.forEach((c) => m.set(c.id, d.id)));
    return m;
  }, [tree.data]);

  const classCovered = (classId: string) => value.whole_school || value.class_ids.includes(classId) || value.department_ids.includes(deptOfClass.get(classId) ?? '');
  const deptCovered = (deptId: string) => value.whole_school || value.department_ids.includes(deptId);

  function setStudent(studentId: string, classId: string | null, on: boolean) {
    if (on) {
      set({
        exclude_student_ids: value.exclude_student_ids.filter((x) => x !== studentId),
        student_ids: classId && classCovered(classId) ? value.student_ids : toggle(value.student_ids, studentId, true),
      });
    } else {
      const coveredByGroup = classId ? classCovered(classId) : false;
      set({
        student_ids: toggle(value.student_ids, studentId, false),
        exclude_student_ids: coveredByGroup ? toggle(value.exclude_student_ids, studentId, true) : value.exclude_student_ids,
      });
    }
  }

  function removeSelected(studentId: string) {
    // Drop a direct pick and exclude the student in case a group also covers them (FR-FLT-006).
    set({ student_ids: toggle(value.student_ids, studentId, false), exclude_student_ids: toggle(value.exclude_student_ids, studentId, true) });
  }

  const p = preview.data;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* Tree + search */}
      <div className="rounded-xl border border-line bg-white">
        <div className="border-b border-line p-3">
          <Input placeholder="Rechercher un élève (nom ou matricule)…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {q.length >= 2 && (
            <ul className="mt-2 max-h-56 divide-y divide-line overflow-y-auto rounded-lg border border-line">
              {results.isLoading && <li className="px-3 py-2 text-sm text-muted">Recherche…</li>}
              {results.data?.items.length === 0 && <li className="px-3 py-2 text-sm text-muted">Aucun élève trouvé</li>}
              {results.data?.items.map((s) => {
                const picked = value.student_ids.includes(s.id) || (!!s.class && classCovered(s.class.id) && !excluded.has(s.id));
                return (
                  <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                    <span>
                      {s.lastName} {s.firstName} <span className="text-muted">· {s.class?.name ?? '—'} · {s.matricule}</span>
                    </span>
                    <button className={cx('text-xs font-medium', picked ? 'text-muted' : 'text-brand-700 hover:underline')} disabled={picked} onClick={() => setStudent(s.id, s.class?.id ?? null, true)}>
                      {picked ? 'Ajouté' : 'Ajouter'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="max-h-[420px] overflow-y-auto p-2 text-sm">
          {tree.isLoading && (
            <div className="p-3 text-muted">
              <Spinner /> Chargement…
            </div>
          )}
          {tree.data && !tree.data.year && <div className="p-3 text-muted">Aucune année active.</div>}
          {tree.data?.year && (
            <>
              <Row>
                <Checkbox
                  checked={value.whole_school}
                  onChange={(on) => set({ whole_school: on, ...(on ? { department_ids: [], class_ids: [], student_ids: [], exclude_student_ids: [] } : {}) })}
                  label={<span className="font-medium">Toute l’école</span>}
                />
              </Row>
              {tree.data.departments.map((d) => (
                <div key={d.id} className="ml-3">
                  <Row>
                    <Toggle open={!!open[d.id]} onClick={() => setOpen((o) => ({ ...o, [d.id]: !o[d.id] }))} />
                    <Checkbox
                      checked={deptCovered(d.id)}
                      indeterminate={d.classes.some((c) => value.class_ids.includes(c.id))}
                      disabled={value.whole_school}
                      onChange={(on) =>
                        set({
                          department_ids: toggle(value.department_ids, d.id, on),
                          class_ids: on ? value.class_ids.filter((c) => !d.classes.some((x) => x.id === c)) : value.class_ids,
                        })
                      }
                      label={<span className="font-medium">{d.name}</span>}
                    />
                  </Row>
                  {open[d.id] &&
                    d.classes.map((c) => (
                      <div key={c.id} className="ml-6">
                        <Row>
                          <Toggle open={!!open[c.id]} onClick={() => setOpen((o) => ({ ...o, [c.id]: !o[c.id] }))} />
                          <Checkbox
                            checked={classCovered(c.id)}
                            disabled={deptCovered(d.id)}
                            onChange={(on) => set({ class_ids: toggle(value.class_ids, c.id, on) })}
                            label={
                              <span>
                                {c.name} <span className="tnum text-xs text-muted">({c.students})</span>
                              </span>
                            }
                          />
                        </Row>
                        {open[c.id] && <ClassStudents classId={c.id} covered={classCovered(c.id)} value={value} onToggle={(sid, on) => setStudent(sid, c.id, on)} />}
                      </div>
                    ))}
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Selected panel + live summary */}
      <div className="flex min-h-0 flex-col rounded-xl border border-line bg-white">
        <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
          <span className="text-sm font-semibold">Sélection</span>
          {preview.isFetching && <Spinner className="size-3.5 text-muted" />}
        </div>
        {unpaidLabel && <div className="border-b border-line bg-amber-50/60 px-3 py-2 text-xs text-amber-900">{unpaidLabel}</div>}
        <ul className="max-h-[300px] min-h-24 flex-1 divide-y divide-line overflow-y-auto">
          {!templateId && <li className="px-3 py-6 text-center text-sm text-muted">Choisissez d’abord un modèle de message.</li>}
          {templateId && p && p.selected.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Aucun élève sélectionné.</li>}
          {p?.selected.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
              <span className="min-w-0">
                <span className="block truncate">{s.name}</span>
                <span className="tnum block text-xs text-muted">
                  {s.class} · {s.phones.join(', ')}
                  {s.balance !== undefined && ` · reste ${xaf(s.balance)}`}
                </span>
              </span>
              <button className="shrink-0 rounded px-1.5 text-xs text-muted hover:bg-stone-100 hover:text-red-700" onClick={() => removeSelected(s.id)} aria-label={`Retirer ${s.name}`}>
                Retirer
              </button>
            </li>
          ))}
          {p?.selected_truncated && <li className="px-3 py-2 text-xs text-muted">Liste tronquée aux 1 000 premiers élèves.</li>}
        </ul>
        {value.exclude_student_ids.length > 0 && (
          <div className="flex items-center justify-between border-t border-line px-3 py-1.5 text-xs text-muted">
            {plural(value.exclude_student_ids.length, 'élève exclu', 'élèves exclus')}
            <button className="text-brand-700 hover:underline" onClick={() => set({ exclude_student_ids: [] })}>
              Réintégrer
            </button>
          </div>
        )}
        <Summary preview={p} />
      </div>
    </div>
  );
}

export function Summary({ preview: p }: { preview?: Preview }) {
  return (
    <div className="grid grid-cols-2 gap-px border-t border-line bg-line text-sm sm:grid-cols-4">
      <Cell label="Élèves" value={p ? p.students.toLocaleString('fr-FR') : '—'} />
      <Cell label="Messages" value={p ? p.messages.toLocaleString('fr-FR') : '—'} />
      <Cell
        label="Sans contact"
        value={p ? String(p.students_without_contact.length) : '—'}
        warn={!!p?.students_without_contact.length}
        title={p?.students_without_contact.map((s) => `${s.name} (${s.class})`).join('\n')}
      />
      <Cell label="Coût estimé" value={p ? xaf(p.estimated_cost_xaf) : '—'} />
      {p && p.daily_limit.days_needed > 1 && (
        <div className="col-span-full bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Limite quotidienne WhatsApp : {p.daily_limit.limit.toLocaleString('fr-FR')} messages/jour ({p.daily_limit.remaining_today.toLocaleString('fr-FR')} restants aujourd’hui). L’envoi sera
          étalé sur {p.daily_limit.days_needed} jours.
        </div>
      )}
      {p && p.template_status !== 'APPROVED' && (
        <div className="col-span-full bg-red-50 px-3 py-2 text-xs text-red-800">Ce modèle n’est pas approuvé par Meta : l’envoi sera bloqué.</div>
      )}
    </div>
  );
}

function Cell({ label, value, warn, title }: { label: string; value: string; warn?: boolean; title?: string }) {
  return (
    <div className="bg-white px-3 py-2" title={title}>
      <div className="text-xs text-muted">{label}</div>
      <div className={cx('tnum font-semibold', warn && 'text-amber-700')}>{value}</div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1 rounded-md px-1 py-1 hover:bg-stone-50">{children}</div>;
}

function Toggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex size-5 items-center justify-center rounded text-muted hover:bg-stone-200" aria-label={open ? 'Replier' : 'Déplier'} aria-expanded={open}>
      <svg viewBox="0 0 12 12" className={cx('size-3 transition-transform', open && 'rotate-90')} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 2.5 8 6l-3.5 3.5" />
      </svg>
    </button>
  );
}

function ClassStudents({ classId, covered, value, onToggle }: { classId: string; covered: boolean; value: RecipientFilter; onToggle: (id: string, on: boolean) => void }) {
  const q = useQuery({ queryKey: ['class-students', classId], queryFn: () => api.get<Paged<StudentRow>>(`/students${qs({ class_id: classId, page_size: 200 })}`) });
  if (q.isLoading) return <div className="ml-7 py-1 text-xs text-muted">Chargement…</div>;
  return (
    <div className="ml-7">
      {q.data?.items.map((s) => {
        const usable = s.contacts.some((c) => !c.isOptedOut);
        const checked = (covered && !value.exclude_student_ids.includes(s.id)) || value.student_ids.includes(s.id);
        return (
          <div key={s.id} className="flex items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-stone-50">
            <Checkbox checked={checked} onChange={(on) => onToggle(s.id, on)} label={`${s.lastName} ${s.firstName}`} />
            {!usable && <Badge tone="amber">sans contact</Badge>}
          </div>
        );
      })}
    </div>
  );
}
