import { formatInstantFr } from '@innovcare/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Badge, Card, Empty, Loading, PageHeader, Stat, Table, Td, xaf } from '../components/ui';
import { api } from '../lib/api';
import { ANOMALY, SOURCE } from '../lib/fr';

interface DashboardData {
  today: string;
  students: number;
  anomalies_today: { id: string; type: string; student: string; student_id: string; class: string; subject: string | null; arrival_time: string | null }[];
  alerts_awaiting: number;
  next_scheduled: { id: string; title: string; source: string; scheduledFor: string; messagesCount: number; estimatedCostXaf: number }[];
  failures_7d: { total: number; by_dispatch: { id: string; title: string; failed: number }[] };
  month: { messages: number; estimated_xaf: number };
}

export default function Dashboard() {
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardData>('/reports/dashboard'), refetchInterval: 60_000 });
  if (q.isLoading || !q.data) return <Loading />;
  const d = q.data;
  return (
    <>
      <PageHeader
        title="Tableau de bord"
        description={new Date(`${d.today}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        actions={
          <>
            <Link to="/absences">
              <span className="inline-flex h-9 items-center rounded-lg border border-line bg-white px-3.5 text-sm font-medium shadow-sm hover:bg-stone-50">Saisir des absences</span>
            </Link>
            <Link to="/envoi">
              <span className="inline-flex h-9 items-center rounded-lg bg-brand-600 px-3.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700">Nouvel envoi</span>
            </Link>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link to="/alertes">
          <Stat label="Alertes à confirmer" value={d.alerts_awaiting} tone={d.alerts_awaiting ? 'amber' : undefined} hint="Absences et retards du jour" />
        </Link>
        <Stat label="Anomalies aujourd’hui" value={d.anomalies_today.length} hint={`${d.students.toLocaleString('fr-FR')} élèves actifs`} />
        <Link to="/historique?status=COMPLETED_WITH_FAILURES">
          <Stat label="Échecs (7 jours)" value={d.failures_7d.total} tone={d.failures_7d.total ? 'red' : undefined} hint="Messages non distribués" />
        </Link>
        <Stat label="Dépense estimée ce mois" value={xaf(d.month.estimated_xaf)} hint={`${d.month.messages.toLocaleString('fr-FR')} messages envoyés`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Anomalies du jour" actions={<Link to="/absences" className="text-xs text-brand-700 hover:underline">Tout voir</Link>} padded={false}>
          {d.anomalies_today.length === 0 ? (
            <Empty title="Aucune anomalie enregistrée aujourd’hui" />
          ) : (
            <Table head={['Élève', 'Classe', 'Type', 'Détail']}>
              {d.anomalies_today.slice(0, 8).map((a) => (
                <tr key={a.id}>
                  <Td>
                    <Link to={`/eleves/${a.student_id}`} className="hover:underline">
                      {a.student}
                    </Link>
                  </Td>
                  <Td>{a.class}</Td>
                  <Td>
                    <Badge tone={a.type === 'ABSENCE' ? 'amber' : 'blue'}>{ANOMALY[a.type]}</Badge>
                  </Td>
                  <Td className="text-muted">{a.type === 'ABSENCE' ? a.subject : a.arrival_time?.replace(':', 'h')}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Prochains envois programmés" actions={<Link to="/programmes" className="text-xs text-brand-700 hover:underline">Tout voir</Link>} padded={false}>
          {d.next_scheduled.length === 0 ? (
            <Empty title="Aucun envoi programmé" />
          ) : (
            <ul className="divide-y divide-line">
              {d.next_scheduled.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate">{s.title}</span>
                    <span className="text-xs text-muted">
                      {SOURCE[s.source]} · {s.messagesCount} messages · {xaf(s.estimatedCostXaf)}
                    </span>
                  </span>
                  <span className="tnum shrink-0 text-[13px] text-muted">{formatInstantFr(s.scheduledFor)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {d.failures_7d.by_dispatch.length > 0 && (
          <Card title="Échecs des 7 derniers jours" padded={false} className="lg:col-span-2">
            <ul className="divide-y divide-line">
              {d.failures_7d.by_dispatch.map((f) => (
                <li key={f.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <Link to={`/historique/${f.id}`} className="hover:underline">
                    {f.title}
                  </Link>
                  <Badge tone="red">{f.failed} en échec</Badge>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
