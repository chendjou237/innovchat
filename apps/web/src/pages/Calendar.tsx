import { RecipientFilter, formatInstantFr, toDay } from '@innovcare/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import RecipientSelector, { emptyFilter } from '../components/RecipientSelector';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Select, Tabs, Textarea, cx, statusTone, useToast } from '../components/ui';
import { api, qs } from '../lib/api';
import { DISPATCH_STATUS, EVENT_TYPE } from '../lib/fr';
import type { Template } from '../lib/types';

interface Trigger {
  id: string;
  daysOffset: number;
  sendTime: string;
  dispatch: { id: string; status: string; scheduledFor: string | null; messagesCount: number; estimatedCostXaf: number } | null;
}
interface CalEvent {
  id: string;
  title: string;
  type: string;
  start_date: string;
  end_date: string;
  startTime: string | null;
  place: string | null;
  description: string | null;
  recipientFilter: RecipientFilter;
  templateId: string | null;
  triggers: Trigger[];
}

const TYPE_COLOR: Record<string, string> = {
  HOLIDAY: 'bg-emerald-100 text-emerald-900',
  MEETING: 'bg-sky-100 text-sky-900',
  EXAM: 'bg-amber-100 text-amber-900',
  EVENT: 'bg-violet-100 text-violet-900',
};

const pad = (n: number) => String(n).padStart(2, '0');
const monthKey = (y: number, m: number) => `${y}-${pad(m + 1)}`;

/** Calendrier: month and list views, event form with audience and trigger rules (FR-CAL, UC-04). */
export default function CalendarPage() {
  const today = toDay(new Date());
  const [view, setView] = useState<'mois' | 'liste'>('mois');
  const [ym, setYm] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const [editing, setEditing] = useState<Partial<CalEvent> | null>(null);

  const from = view === 'mois' ? `${monthKey(ym.y, ym.m)}-01` : today;
  const to = view === 'mois' ? toDay(new Date(Date.UTC(ym.y, ym.m + 1, 0, 12))) : '';
  const events = useQuery({ queryKey: ['events', from, to], queryFn: () => api.get<CalEvent[]>(`/calendar/events${qs({ from, to })}`) });

  const shift = (d: number) => setYm(({ y, m }) => ({ y: m + d < 0 ? y - 1 : m + d > 11 ? y + 1 : y, m: (m + d + 12) % 12 }));
  const monthLabel = new Date(Date.UTC(ym.y, ym.m, 15)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <>
      <PageHeader
        title="Calendrier"
        description="Chaque événement peut envoyer automatiquement des messages (ex. 7 jours avant à 08:00, le jour même à 07:00)."
        actions={
          <Button variant="primary" onClick={() => setEditing({ start_date: today, end_date: today, type: 'MEETING', triggers: [] })}>
            Nouvel événement
          </Button>
        }
      />
      <Tabs value={view} onChange={setView} items={[{ value: 'mois', label: 'Mois' }, { value: 'liste', label: 'Liste (à venir)' }]} />
      {view === 'mois' ? (
        <Card
          title={<span className="capitalize">{monthLabel}</span>}
          actions={
            <>
              <Button size="sm" variant="ghost" onClick={() => shift(-1)} aria-label="Mois précédent">←</Button>
              <Button size="sm" variant="ghost" onClick={() => setYm({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 })}>Aujourd’hui</Button>
              <Button size="sm" variant="ghost" onClick={() => shift(1)} aria-label="Mois suivant">→</Button>
            </>
          }
          padded={false}
        >
          <MonthGrid y={ym.y} m={ym.m} today={today} events={events.data ?? []} onPick={(e) => setEditing(e)} onNew={(d) => setEditing({ start_date: d, end_date: d, type: 'MEETING', triggers: [] })} />
        </Card>
      ) : (
        <Card padded={false}>
          {events.isLoading ? (
            <Loading />
          ) : !events.data?.length ? (
            <Empty title="Aucun événement à venir" />
          ) : (
            <ul className="divide-y divide-line">
              {events.data.map((e) => (
                <li key={e.id}>
                  <button className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-stone-50" onClick={() => setEditing(e)}>
                    <span className="tnum w-28 shrink-0 text-sm font-medium">
                      {e.start_date.split('-').reverse().join('/')}
                      {e.end_date !== e.start_date && <span className="block text-xs font-normal text-muted">au {e.end_date.split('-').reverse().join('/')}</span>}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{e.title}</span>
                      <span className="text-xs text-muted">
                        {EVENT_TYPE[e.type]}
                        {e.startTime && ` · ${e.startTime.replace(':', 'h')}`}
                        {e.place && ` · ${e.place}`}
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {e.triggers.map((t) => (
                        <Badge key={t.id} tone={t.dispatch ? statusTone(t.dispatch.status) : 'neutral'}>
                          {offsetLabel(t.daysOffset)} {t.sendTime}
                        </Badge>
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {editing && <EventForm event={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

const offsetLabel = (o: number) => (o === 0 ? 'Jour J' : o < 0 ? `J-${-o}` : `J+${o}`);

function MonthGrid({ y, m, today, events, onPick, onNew }: { y: number; m: number; today: string; events: CalEvent[]; onPick: (e: CalEvent) => void; onNew: (day: string) => void }) {
  const days = useMemo(() => {
    const first = new Date(Date.UTC(y, m, 1));
    const offset = (first.getUTCDay() + 6) % 7; // Monday first
    const start = Date.UTC(y, m, 1 - offset);
    return Array.from({ length: 42 }, (_, i) => new Date(start + i * 86400000).toISOString().slice(0, 10));
  }, [y, m]);
  const inMonth = (d: string) => d.slice(0, 7) === monthKey(y, m);
  return (
    <div>
      <div className="grid grid-cols-7 border-b border-line text-center text-xs font-medium text-muted">
        {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d) => (
          <div key={d} className="py-2">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const dayEvents = events.filter((e) => e.start_date <= d && e.end_date >= d);
          return (
            <div
              key={d}
              onDoubleClick={() => onNew(d)}
              className={cx('min-h-24 border-line p-1.5', i % 7 !== 6 && 'border-r', i < 35 && 'border-b', !inMonth(d) && 'bg-stone-50/70')}
            >
              <div className={cx('tnum mb-1 text-xs', d === today ? 'inline-flex size-5 items-center justify-center rounded-full bg-brand-600 font-semibold text-white' : inMonth(d) ? 'text-ink' : 'text-stone-400')}>
                {Number(d.slice(8))}
              </div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map((e) => (
                  <button key={e.id} onClick={() => onPick(e)} className={cx('block w-full truncate rounded px-1 py-0.5 text-left text-[11.5px] font-medium', TYPE_COLOR[e.type])} title={e.title}>
                    {e.start_date === d && e.startTime ? `${e.startTime} ` : ''}
                    {e.title}
                  </button>
                ))}
                {dayEvents.length > 3 && <div className="px-1 text-[11px] text-muted">+{dayEvents.length - 3}</div>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-line px-4 py-2 text-xs text-muted">Double-cliquez sur un jour pour créer un événement.</div>
    </div>
  );
}

function EventForm({ event, onClose }: { event: Partial<CalEvent>; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => api.get<Template[]>('/templates') });
  const calendarTemplates = templates.data?.filter((t) => t.purpose === 'CALENDAR') ?? [];
  const [f, setF] = useState({
    title: event.title ?? '',
    type: event.type ?? 'MEETING',
    start_date: event.start_date ?? '',
    end_date: event.end_date ?? '',
    start_time: event.startTime ?? '',
    place: event.place ?? '',
    description: event.description ?? '',
    template_id: event.templateId ?? '',
  });
  const [filter, setFilter] = useState<RecipientFilter>({ ...emptyFilter(), ...(event.recipientFilter ?? { whole_school: true }) });
  const [triggers, setTriggers] = useState<{ days_offset: number; send_time: string }[]>(
    event.id ? (event.triggers ?? []).map((t) => ({ days_offset: t.daysOffset, send_time: t.sendTime })) : [{ days_offset: -7, send_time: '08:00' }],
  );
  const templateId = f.template_id || calendarTemplates.find((t) => t.metaStatus === 'APPROVED')?.id || calendarTemplates[0]?.id;

  const done = (msg: string) => {
    toast(msg);
    void qc.invalidateQueries({ queryKey: ['events'] });
    void qc.invalidateQueries({ queryKey: ['scheduled'] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        start_time: f.start_time || null,
        place: f.place || null,
        description: f.description || null,
        template_id: f.template_id || null,
        end_date: f.end_date || f.start_date,
        recipient_filter: filter,
        triggers,
      };
      return event.id ? api.put<{ warnings: string[] }>(`/calendar/events/${event.id}`, body) : api.post<{ warnings: string[] }>('/calendar/events', body);
    },
    onSuccess: (r) => {
      r.warnings?.forEach((w) => toast(w, 'error'));
      done(event.id ? 'Événement mis à jour' : 'Événement créé');
    },
  });
  const remove = useMutation({ mutationFn: () => api.del(`/calendar/events/${event.id}`), onSuccess: () => done('Événement supprimé, envois en attente annulés') });

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={event.id ? 'Modifier l’événement' : 'Nouvel événement'}
      footer={
        <>
          {event.id && (
            <Button variant="danger" className="mr-auto" loading={remove.isPending} onClick={() => confirm('Supprimer cet événement ? Les envois programmés seront annulés ; les messages déjà envoyés ne sont pas affectés.') && remove.mutate()}>
              Supprimer
            </Button>
          )}
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.title || !f.start_date} onClick={() => save.mutate()}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Titre" className="sm:col-span-2">
            <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Réunion des parents" autoFocus />
          </Field>
          <Field label="Type">
            <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {Object.entries(EVENT_TYPE).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Field>
          <Field label="Début">
            <Input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value, end_date: f.end_date < e.target.value ? e.target.value : f.end_date })} />
          </Field>
          <Field label="Fin">
            <Input type="date" value={f.end_date} min={f.start_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} />
          </Field>
          <Field label="Heure (facultatif)">
            <Input type="time" value={f.start_time} onChange={(e) => setF({ ...f, start_time: e.target.value })} />
          </Field>
          <Field label="Lieu (facultatif)" className="sm:col-span-3">
            <Input value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} />
          </Field>
          <Field label="Description (facultatif)" className="sm:col-span-3">
            <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="min-h-14" />
          </Field>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-medium">Envois automatiques</span>
            <Button size="sm" onClick={() => setTriggers([...triggers, { days_offset: 0, send_time: '07:00' }])}>
              Ajouter un envoi
            </Button>
          </div>
          {triggers.length === 0 && <p className="text-sm text-muted">Aucun envoi : l’événement apparaît seulement dans le calendrier.</p>}
          <ul className="space-y-2">
            {triggers.map((t, i) => {
              const existing = event.triggers?.find((x) => x.daysOffset === t.days_offset && x.sendTime === t.send_time);
              return (
                <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                  <Input
                    type="number"
                    className="w-20"
                    value={Math.abs(t.days_offset)}
                    min={0}
                    onChange={(e) => setTriggers(triggers.map((x, j) => (j === i ? { ...x, days_offset: Math.sign(x.days_offset || -1) * Number(e.target.value) } : x)))}
                  />
                  <Select
                    className="w-44"
                    value={t.days_offset === 0 ? 'same' : t.days_offset < 0 ? 'before' : 'after'}
                    onChange={(e) =>
                      setTriggers(
                        triggers.map((x, j) => (j === i ? { ...x, days_offset: e.target.value === 'same' ? 0 : (e.target.value === 'before' ? -1 : 1) * (Math.abs(x.days_offset) || 1) } : x)),
                      )
                    }
                  >
                    <option value="before">jour(s) avant</option>
                    <option value="same">le jour même</option>
                    <option value="after">jour(s) après</option>
                  </Select>
                  <span className="text-muted">à</span>
                  <Input type="time" className="w-32" value={t.send_time} onChange={(e) => setTriggers(triggers.map((x, j) => (j === i ? { ...x, send_time: e.target.value } : x)))} />
                  {existing?.dispatch && (
                    <Badge tone={statusTone(existing.dispatch.status)}>
                      {DISPATCH_STATUS[existing.dispatch.status]}
                      {existing.dispatch.scheduledFor && existing.dispatch.status === 'SCHEDULED' && ` · ${formatInstantFr(existing.dispatch.scheduledFor)}`}
                    </Badge>
                  )}
                  <button className="ml-auto text-xs text-muted hover:text-red-700" onClick={() => setTriggers(triggers.filter((_, j) => j !== i))}>
                    Retirer
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {calendarTemplates.length > 1 && (
          <Field label="Modèle de message">
            <Select value={f.template_id} onChange={(e) => setF({ ...f, template_id: e.target.value })}>
              <option value="">Par défaut</option>
              {calendarTemplates.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </Select>
          </Field>
        )}

        <div>
          <div className="mb-2 text-[13px] font-medium">Public concerné</div>
          <RecipientSelector value={filter} onChange={setFilter} templateId={templateId} />
        </div>
        <ErrorNote error={save.error ?? remove.error} />
      </div>
    </Modal>
  );
}
