import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import TabBar from './components/TabBar';
import { ConfirmProvider } from './components/ConfirmDialog';
import AppShell from './components/AppShell';
import Week from './screens/Week';
import List from './screens/List';
import Plan from './screens/Plan';
import HouseholdScreen from './screens/Household';
import Pantry from './screens/Pantry';
import Login from './screens/Login';
import { SessionProvider, safeNext, useSession } from './session';

export default function App() {
  return (
    <SessionProvider>
      <ConfirmProvider>
        <AppRoutes />
      </ConfirmProvider>
    </SessionProvider>
  );
}

/** Shows nothing until the session check answers. Signed out, everything but the sign-in page goes there. */
function AppRoutes() {
  const { state } = useSession();
  const { pathname, search } = useLocation();

  if (state.status === 'loading') return null;

  if (pathname === '/login') {
    if (state.status === 'in') return <Navigate to={safeNext(new URLSearchParams(search).get('next'))} replace />;
    return (
      <div className="min-h-screen bg-ink font-sans text-paper lg:flex lg:items-center lg:justify-center">
        <Login />
      </div>
    );
  }

  if (state.status === 'out') {
    return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />;
  }

  return (
    <div className="min-h-screen bg-ink font-sans text-paper">
      <AppShell>
        <Routes>
          <Route path="/" element={<Week />} />
          <Route path="/list" element={<List />} />
          <Route path="/plan" element={<Plan />} />
          <Route path="/household" element={<HouseholdScreen />} />
          <Route path="/pantry" element={<Pantry />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
      <TabBar />
    </div>
  );
}
