import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, Loading, Modal, PageHeader, Table, Tabs, Td, useToast, xaf } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { META_CATEGORY } from '../lib/fr';

interface SettingsView {
  school_name: string;
  school_phone: string;
  wa_phone_number_id: string;
  wa_business_account_id: string;
  wa_access_token_set: boolean;
  wa_app_secret_set: boolean;
  wa_verify_token_set: boolean;
  wa_messages_per_second: number;
  wa_daily_limit: number;
  price_utility_xaf: number;
  price_marketing_xaf: number;
  price_authentication_xaf: number;
  provider: string;
}
interface Admin {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  lastLoginAt: string | null;
}

/** Paramètres: administrators, WhatsApp connection, prices per category, monthly spend (FR-ORG-005, FR-CST). */
export default function Settings() {
  const [tab, setTab] = useState<'ecole' | 'whatsapp' | 'couts' | 'admins'>('ecole');
  return (
    <>
      <PageHeader title="Paramètres" />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'ecole', label: 'École' },
          { value: 'whatsapp', label: 'Connexion WhatsApp' },
          { value: 'couts', label: 'Coûts' },
          { value: 'admins', label: 'Administrateurs' },
        ]}
      />
      {tab === 'admins' ? <Admins /> : tab === 'couts' ? <Costs /> : <SettingsForm section={tab} />}
    </>
  );
}

function SettingsForm({ section }: { section: 'ecole' | 'whatsapp' }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsView>('/settings') });
  const [f, setF] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data)
      setF({
        school_name: q.data.school_name,
        school_phone: q.data.school_phone,
        wa_phone_number_id: q.data.wa_phone_number_id,
        wa_business_account_id: q.data.wa_business_account_id,
        wa_messages_per_second: String(q.data.wa_messages_per_second),
        wa_daily_limit: String(q.data.wa_daily_limit),
        wa_access_token: '',
        wa_app_secret: '',
        wa_verify_token: '',
      });
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> =
        section === 'ecole'
          ? { school_name: f.school_name, school_phone: f.school_phone }
          : {
              wa_phone_number_id: f.wa_phone_number_id,
              wa_business_account_id: f.wa_business_account_id,
              wa_access_token: f.wa_access_token,
              wa_app_secret: f.wa_app_secret,
              wa_verify_token: f.wa_verify_token,
              wa_messages_per_second: Number(f.wa_messages_per_second),
              wa_daily_limit: Number(f.wa_daily_limit),
            };
      return api.put<SettingsView>('/settings', body);
    },
    onSuccess: (d) => {
      qc.setQueryData(['settings'], d);
      toast('Paramètres enregistrés');
    },
  });
  if (!q.data) return <Loading />;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const secret = (k: string, label: string, isSet: boolean) => (
    <Field label={label} hint={isSet ? 'Configuré. Laissez vide pour conserver la valeur actuelle.' : 'Non configuré.'}>
      <Input type="password" autoComplete="off" value={f[k] ?? ''} onChange={set(k)} placeholder={isSet ? '••••••••' : ''} />
    </Field>
  );
  return (
    <Card>
      {section === 'ecole' ? (
        <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
          <Field label="Nom de l’école" hint="Utilisé dans les messages.">
            <Input value={f.school_name ?? ''} onChange={set('school_name')} />
          </Field>
          <Field label="Téléphone de l’école" hint="Indiqué dans chaque message : le numéro WhatsApp ne lit pas les réponses.">
            <Input value={f.school_phone ?? ''} onChange={set('school_phone')} />
          </Field>
        </div>
      ) : (
        <div className="max-w-2xl space-y-4">
          <div className="text-sm">
            Fournisseur actif : <Badge tone={q.data.provider === 'graph' ? 'green' : 'amber'}>{q.data.provider === 'graph' ? 'WhatsApp Cloud API' : 'Simulation (mode test)'}</Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone number ID"><Input value={f.wa_phone_number_id ?? ''} onChange={set('wa_phone_number_id')} /></Field>
            <Field label="WhatsApp Business Account ID"><Input value={f.wa_business_account_id ?? ''} onChange={set('wa_business_account_id')} /></Field>
            {secret('wa_access_token', 'Jeton d’accès permanent (system user)', q.data.wa_access_token_set)}
            {secret('wa_app_secret', 'App secret (signature du webhook)', q.data.wa_app_secret_set)}
            {secret('wa_verify_token', 'Jeton de vérification du webhook', q.data.wa_verify_token_set)}
            <Field label="Adresse du webhook à déclarer chez Meta">
              <Input readOnly value={`${window.location.origin}/api/v1/webhooks/whatsapp`} onFocus={(e) => e.target.select()} />
            </Field>
            <Field label="Messages par seconde" hint="Débit autorisé par Meta pour le numéro.">
              <Input inputMode="numeric" value={f.wa_messages_per_second ?? ''} onChange={set('wa_messages_per_second')} />
            </Field>
            <Field label="Limite quotidienne" hint="Palier Meta du numéro (250, 1 000, 10 000…). Au-delà, l’envoi reprend le lendemain à 07:00.">
              <Input inputMode="numeric" value={f.wa_daily_limit ?? ''} onChange={set('wa_daily_limit')} />
            </Field>
          </div>
        </div>
      )}
      <div className="mt-4 flex items-center gap-3">
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Enregistrer</Button>
        <ErrorNote error={save.error} />
      </div>
    </Card>
  );
}

function Costs() {
  const qc = useQueryClient();
  const toast = useToast();
  const s = useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsView>('/settings') });
  const report = useQuery({ queryKey: ['monthly'], queryFn: () => api.get<{ rows: { month: string; category: string; messages: number; estimated_xaf: number }[] }>('/reports/monthly?months=12') });
  const [p, setP] = useState({ u: '', m: '', a: '' });
  useEffect(() => {
    if (s.data) setP({ u: String(s.data.price_utility_xaf), m: String(s.data.price_marketing_xaf), a: String(s.data.price_authentication_xaf) });
  }, [s.data]);
  const save = useMutation({
    mutationFn: () => api.put('/settings', { price_utility_xaf: Number(p.u), price_marketing_xaf: Number(p.m), price_authentication_xaf: Number(p.a) }),
    onSuccess: () => {
      toast('Tarifs enregistrés');
      void qc.invalidateQueries();
    },
  });
  const months = [...new Set(report.data?.rows.map((r) => r.month))].sort().reverse();
  return (
    <div className="space-y-4">
      <Card title="Prix par message (FCFA)">
        <p className="mb-3 text-sm text-muted">Tarifs Meta par catégorie de modèle, utilisés pour l’estimation affichée avant chaque envoi. Les frais sont à la charge du propriétaire du système.</p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Utilitaire"><Input className="w-32" value={p.u} onChange={(e) => setP({ ...p, u: e.target.value })} /></Field>
          <Field label="Marketing"><Input className="w-32" value={p.m} onChange={(e) => setP({ ...p, m: e.target.value })} /></Field>
          <Field label="Authentification"><Input className="w-32" value={p.a} onChange={(e) => setP({ ...p, a: e.target.value })} /></Field>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Enregistrer</Button>
        </div>
      </Card>
      <Card title="Dépense estimée par mois" padded={false}>
        {!months.length ? (
          <div className="px-4 py-6 text-sm text-muted">Aucun message envoyé pour l’instant.</div>
        ) : (
          <Table head={['Mois', 'Catégorie', 'Messages', 'Dépense estimée']}>
            {months.flatMap((mo) => {
              const rows = report.data!.rows.filter((r) => r.month === mo);
              const label = new Date(`${mo}-15T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
              return [
                ...rows.map((r, i) => (
                  <tr key={mo + r.category}>
                    <Td className="capitalize">{i === 0 ? label : ''}</Td>
                    <Td>{META_CATEGORY[r.category]}</Td>
                    <Td className="tnum">{r.messages.toLocaleString('fr-FR')}</Td>
                    <Td className="tnum">{xaf(r.estimated_xaf)}</Td>
                  </tr>
                )),
                <tr key={mo + 'total'} className="bg-stone-50 font-medium">
                  <Td />
                  <Td>Total</Td>
                  <Td className="tnum">{rows.reduce((n, r) => n + r.messages, 0).toLocaleString('fr-FR')}</Td>
                  <Td className="tnum">{xaf(rows.reduce((n, r) => n + r.estimated_xaf, 0))}</Td>
                </tr>,
              ];
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}

function Admins() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['admins'], queryFn: () => api.get<Admin[]>('/admins') });
  const [creating, setCreating] = useState(false);
  const [reset, setReset] = useState<Admin | null>(null);
  const [f, setF] = useState({ email: '', fullName: '', password: '' });
  const [pwd, setPwd] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['admins'] });
  const create = useMutation({ mutationFn: () => api.post('/admins', f), onSuccess: () => (toast('Administrateur créé'), setCreating(false), setF({ email: '', fullName: '', password: '' }), refresh()) });
  const toggle = useMutation({ mutationFn: (a: Admin) => api.patch(`/admins/${a.id}`, { isActive: !a.isActive }), onSuccess: () => refresh(), onError: (e) => toast((e as Error).message, 'error') });
  const doReset = useMutation({ mutationFn: () => api.post(`/admins/${reset!.id}/reset-password`, { password: pwd }), onSuccess: () => (toast('Mot de passe réinitialisé'), setReset(null), setPwd('')) });
  return (
    <Card title="Administrateurs" actions={<Button size="sm" variant="primary" onClick={() => setCreating(true)}>Ajouter</Button>} padded={false}>
      {!q.data ? (
        <Loading />
      ) : (
        <Table head={['Nom', 'E-mail', 'Dernière connexion', 'Statut', '']}>
          {q.data.map((a) => (
            <tr key={a.id}>
              <Td className="font-medium">{a.fullName}</Td>
              <Td>{a.email}</Td>
              <Td className="tnum text-muted">{a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</Td>
              <Td>{a.isActive ? <Badge tone="green">Actif</Badge> : <Badge>Désactivé</Badge>}</Td>
              <Td className="whitespace-nowrap text-right">
                <Button size="sm" variant="ghost" onClick={() => setReset(a)}>Réinitialiser le mot de passe</Button>
                {a.id !== user?.id && (
                  <Button size="sm" variant="ghost" onClick={() => toggle.mutate(a)}>{a.isActive ? 'Désactiver' : 'Réactiver'}</Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Nouvel administrateur"
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Annuler</Button>
            <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>Créer</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Nom complet"><Input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
          <Field label="E-mail"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Mot de passe provisoire" hint="8 caractères minimum."><Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          <ErrorNote error={create.error} />
        </div>
      </Modal>
      <Modal
        open={!!reset}
        onClose={() => setReset(null)}
        title={`Nouveau mot de passe — ${reset?.fullName}`}
        footer={
          <>
            <Button onClick={() => setReset(null)}>Annuler</Button>
            <Button variant="primary" loading={doReset.isPending} onClick={() => doReset.mutate()}>Enregistrer</Button>
          </>
        }
      >
        <Field label="Mot de passe" hint="Ses sessions ouvertes seront fermées."><Input type="password" autoComplete="new-password" value={pwd} onChange={(e) => setPwd(e.target.value)} /></Field>
        <div className="mt-3"><ErrorNote error={doReset.error} /></div>
      </Modal>
    </Card>
  );
}
