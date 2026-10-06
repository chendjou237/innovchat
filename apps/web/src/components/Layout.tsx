import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Notification, Year } from '../lib/types';
import { cx } from './ui';

const NAV: { section?: string; items: { to: string; label: string; badge?: 'alerts' }[] }[] = [
  { items: [{ to: '/', label: 'Tableau de bord' }] },
  {
    section: 'École',
    items: [
      { to: '/structure', label: 'Années, départements, classes' },
      { to: '/eleves', label: 'Élèves' },
      { to: '/import', label: 'Import' },
      { to: '/passage', label: 'Passage en classe supérieure' },
    ],
  },
  {
    section: 'Suivi',
    items: [
      { to: '/absences', label: 'Absences et retards' },
      { to: '/alertes', label: 'Alertes à confirmer', badge: 'alerts' },
      { to: '/calendrier', label: 'Calendrier' },
      { to: '/frais', label: 'Frais scolaires' },
    ],
  },
  {
    section: 'Messages',
    items: [
      { to: '/envoi', label: 'Nouvel envoi' },
      { to: '/programmes', label: 'Envois programmés' },
      { to: '/historique', label: 'Historique' },
      { to: '/messages/modeles', label: 'Modèles' },
    ],
  },
  { items: [{ to: '/parametres', label: 'Paramètres' }] },
];

export default function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setMenuOpen(false), [loc.pathname]);

  const alerts = useQuery({ queryKey: ['alerts-count'], queryFn: () => api.get<unknown[]>('/alerts/pending').then((a) => a.length), refetchInterval: 30_000 });

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 w-[248px] overflow-y-auto border-r border-line bg-[#fbfaf8] px-3 py-4 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          menuOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full',
        )}
      >
        <div className="mb-5 flex items-center gap-2 px-2">
          <img src="/favicon.svg" alt="" className="size-7" />
          <span className="text-[14px] font-semibold leading-tight">
            Innovcare
            <br />
            <span className="font-normal text-muted">Notifications WhatsApp</span>
          </span>
        </div>
        <nav className="space-y-4">
          {NAV.map((group, i) => (
            <div key={i}>
              {group.section && <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-stone-400">{group.section}</div>}
              <ul className="space-y-0.5">
                {group.items.map((it) => (
                  <li key={it.to}>
                    <NavLink
                      to={it.to}
                      end={it.to === '/'}
                      className={({ isActive }) =>
                        cx(
                          'flex items-center justify-between rounded-md px-2 py-1.5 text-[13.5px] transition-colors',
                          isActive ? 'bg-white font-medium text-ink shadow-[0_0_0_1px_var(--color-line)]' : 'text-stone-600 hover:bg-stone-200/50 hover:text-ink',
                        )
                      }
                    >
                      {it.label}
                      {it.badge === 'alerts' && !!alerts.data && (
                        <span className="tnum rounded-full bg-amber-500 px-1.5 text-[11px] font-semibold text-white">{alerts.data}</span>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      {menuOpen && <div className="fixed inset-0 z-30 bg-black/20 lg:hidden" onClick={() => setMenuOpen(false)} />}

      <div className="min-w-0">
        <TopBar onMenu={() => setMenuOpen(true)} />
        <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { user, logout } = useAuth();
  const years = useQuery({ queryKey: ['years'], queryFn: () => api.get<Year[]>('/academic-years') });
  const active = years.data?.find((y) => y.isActive);
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-canvas/90 px-4 backdrop-blur sm:px-6 lg:px-8">
      <button className="rounded-md p-1.5 hover:bg-stone-200/60 lg:hidden" onClick={onMenu} aria-label="Menu">
        <svg viewBox="0 0 20 20" className="size-5" fill="currentColor">
          <path d="M3 5h14v1.5H3zm0 4.25h14v1.5H3zm0 4.25h14V15H3z" />
        </svg>
      </button>
      <div className="text-[13px] text-muted">
        Année active :{' '}
        <span className="font-medium text-ink">{active ? active.label : years.isLoading ? '…' : <NavLink to="/structure" className="text-red-700 underline">aucune</NavLink>}</span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Bell />
        <Menu label={user?.fullName ?? ''}>
          <div className="px-3 py-2 text-xs text-muted">{user?.email}</div>
          <NavLink to="/parametres" className="block px-3 py-1.5 text-sm hover:bg-stone-100">
            Paramètres
          </NavLink>
          <button onClick={() => void logout()} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-stone-100">
            Se déconnecter
          </button>
        </Menu>
      </div>
    </header>
  );
}

function Menu({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium hover:bg-stone-200/60">
        {label} <span className="text-muted">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 overflow-hidden rounded-lg border border-line bg-white py-1 shadow-lg" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Notification bell: failures and items waiting for confirmation (§2.1). */
function Bell() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const q = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ unread: number; items: Notification[] }>('/notifications'),
    refetchInterval: 30_000,
  });
  const read = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const unread = q.data?.unread ?? 0;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-md p-1.5 hover:bg-stone-200/60" aria-label={`Notifications (${unread} non lues)`}>
        <svg viewBox="0 0 20 20" className="size-5 text-stone-600" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M10 3a4.5 4.5 0 0 0-4.5 4.5c0 3.5-1.5 5-1.5 5h12s-1.5-1.5-1.5-5A4.5 4.5 0 0 0 10 3Zm-1.7 12.5a1.8 1.8 0 0 0 3.4 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unread > 0 && <span className="tnum absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-4 text-white">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-line bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button className="text-xs text-brand-700 hover:underline" onClick={() => readAll.mutate()}>
                Tout marquer comme lu
              </button>
            )}
          </div>
          <ul className="max-h-96 divide-y divide-line overflow-y-auto">
            {(q.data?.items ?? []).length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Aucune notification</li>}
            {q.data?.items.map((n) => (
              <li key={n.id}>
                <button
                  className={cx('block w-full px-3 py-2.5 text-left text-sm hover:bg-stone-50', !n.isRead && 'bg-amber-50/40')}
                  onClick={() => {
                    if (!n.isRead) read.mutate(n.id);
                    setOpen(false);
                    if (n.link) nav(n.link);
                  }}
                >
                  <div className="flex items-start gap-2">
                    <span className={cx('mt-1.5 size-1.5 shrink-0 rounded-full', n.isRead ? 'bg-transparent' : n.type === 'DISPATCH_FAILURES' || n.type === 'TEMPLATE_REJECTED' ? 'bg-red-500' : 'bg-amber-500')} />
                    <span>
                      <span className={cx('block', !n.isRead && 'font-medium')}>{n.title}</span>
                      <span className="text-xs text-muted">{new Date(n.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
