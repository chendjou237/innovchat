import { BrowserRouter, Route, Routes } from 'react-router';
import Layout from './components/Layout';
import { Loading, ToastProvider } from './components/ui';
import { AuthProvider, useAuth } from './lib/auth';
import Alerts from './pages/Alerts';
import Attendance from './pages/Attendance';
import CalendarPage from './pages/Calendar';
import Dashboard from './pages/Dashboard';
import Fees from './pages/Fees';
import History, { HistoryDetail } from './pages/History';
import ImportPage from './pages/Import';
import Login from './pages/Login';
import NewDispatch from './pages/NewDispatch';
import Promotion from './pages/Promotion';
import Scheduled from './pages/Scheduled';
import Settings from './pages/Settings';
import Structure from './pages/Structure';
import StudentDetail from './pages/StudentDetail';
import Students from './pages/Students';
import Templates from './pages/Templates';

function Shell() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="structure" element={<Structure />} />
        <Route path="eleves" element={<Students />} />
        <Route path="eleves/:id" element={<StudentDetail />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="import/:id" element={<ImportPage />} />
        <Route path="passage" element={<Promotion />} />
        <Route path="absences" element={<Attendance />} />
        <Route path="alertes" element={<Alerts />} />
        <Route path="calendrier" element={<CalendarPage />} />
        <Route path="frais" element={<Fees />} />
        <Route path="envoi" element={<NewDispatch />} />
        <Route path="programmes" element={<Scheduled />} />
        <Route path="historique" element={<History />} />
        <Route path="historique/:id" element={<HistoryDetail />} />
        <Route path="messages/modeles" element={<Templates />} />
        <Route path="parametres" element={<Settings />} />
        <Route path="*" element={<div className="text-sm text-muted">Page introuvable.</div>} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
