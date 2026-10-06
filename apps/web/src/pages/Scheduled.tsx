import { formatInstantFr } from '@innovcare/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { Badge, Button, Card, Empty, Loading, PageHeader, Table, Td, useToast, xaf } from '../components/ui';
import { api } from '../lib/api';
import { SOURCE } from '../lib/fr';
import type { Dispatch } from '../lib/types';

/** Envois programmés (FR-SCH-004/005, FR-CST-002). */
export default function Scheduled() {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['scheduled'], queryFn: () => api.get<Dispatch[]>('/dispatches/scheduled'), refetchInterval: 30_000 });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/dispatches/${id}/cancel`),
    onSuccess: () => {
      toast('Envoi annulé');
      void qc.invalidateQueries({ queryKey: ['scheduled'] });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const edit = (d: Dispatch) => {
    if (d.source === 'CALENDAR') nav('/calendrier');
    else if (d.source === 'FEE_RULE') nav('/frais');
    else nav(`/envoi?edit=${d.id}`);
  };

  return (
    <>
      <PageHeader
        title="Envois programmés"
        description="Les destinataires, soldes et détails d’événement sont relus au moment de l’envoi. Un envoi reste modifiable jusqu’à son démarrage."
        actions={
          <Link to="/envoi">
            <Button variant="primary">Nouvel envoi</Button>
          </Link>
        }
      />
      <Card padded={false}>
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.length ? (
          <Empty title="Aucun envoi programmé" />
        ) : (
          <Table head={['Date d’envoi', 'Envoi', 'Source', 'Audience', 'Coût estimé', '']}>
            {q.data.map((d) => (
              <tr key={d.id}>
                <Td className="tnum whitespace-nowrap font-medium">{d.scheduledFor && formatInstantFr(d.scheduledFor)}</Td>
                <Td>
                  {d.title}
                  <div className="text-xs text-muted">{d.template?.title}</div>
                </Td>
                <Td>
                  <Badge tone={d.source === 'MANUAL' ? 'neutral' : 'blue'}>{SOURCE[d.source]}</Badge>
                  {d.eventTrigger && <div className="mt-0.5 text-xs text-muted">{d.eventTrigger.event.title}</div>}
                  {d.feeRule && <div className="mt-0.5 text-xs text-muted">{d.feeRule.installment.name}</div>}
                </Td>
                <Td className="tnum whitespace-nowrap">
                  {d.studentsCount} élèves · {d.messagesCount} msg
                </Td>
                <Td className="tnum whitespace-nowrap">{xaf(d.estimatedCostXaf)}</Td>
                <Td className="whitespace-nowrap text-right">
                  <Button size="sm" variant="ghost" onClick={() => edit(d)}>
                    Modifier
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-700" onClick={() => confirm('Annuler cet envoi programmé ?') && cancel.mutate(d.id)}>
                    Annuler
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
