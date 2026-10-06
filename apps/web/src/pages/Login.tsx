import { FormEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, ErrorNote, Field, Input } from '../components/ui';
import { api } from '../lib/api';
import type { User } from '../lib/types';

export default function Login() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ user: User }>('/auth/login', { email, password });
      qc.setQueryData(['me'], r.user);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-9" />
          <div>
            <div className="text-[15px] font-semibold leading-tight">Innovcare</div>
            <div className="text-[13px] text-muted">Notifications WhatsApp · espace administrateur</div>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-line bg-white p-5 shadow-sm">
          <Field label="Adresse e-mail">
            <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
          <Field label="Mot de passe">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorNote error={error} />
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            Se connecter
          </Button>
        </form>
      </div>
    </div>
  );
}
