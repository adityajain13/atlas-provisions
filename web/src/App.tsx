import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import TabBar from './components/TabBar';
import { ConfirmProvider } from './components/ConfirmDialog';
import { SaveStatusProvider } from './components/SaveStatus';
import AppShell from './components/AppShell';
import Week from './screens/Week';
import List from './screens/List';
import Plan from './screens/Plan';
import HouseholdScreen from './screens/Household';
import Pantry from './screens/Pantry';
import Setup from './screens/Setup';
import Login from './screens/Login';
import { InviteBanner } from './components/InviteBanner';
import { SessionProvider, safeNext, useSession } from './session';
import { SetupGateProvider, useSetupGate } from './setupGate';

export default function App() {
  return (
    <SessionProvider>
      <ConfirmProvider>
        <SaveStatusProvider>
          <AppRoutes />
        </SaveStatusProvider>
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
    <SetupGateProvider>
      <SignedInRoutes />
    </SetupGateProvider>
  );
}

/**
 * The app for a signed-in address. A household with unfinished first-time setup is sent to /setup, which is the
 * one full-screen page: no side nav and no tab bar. Nothing is routed until the household check has answered.
 */
function SignedInRoutes() {
  const gate = useSetupGate();
  const { pathname } = useLocation();

  if (!gate.ready) return null;
  if (!gate.setupDone && pathname !== '/setup') return <Navigate to="/setup" replace />;

  const routes = (
    <Routes>
      <Route path="/" element={<Week />} />
      <Route path="/list" element={<List />} />
      <Route path="/plan" element={<Plan />} />
      <Route path="/household" element={<HouseholdScreen />} />
      <Route path="/pantry" element={<Pantry />} />
      <Route path="/setup" element={<Setup />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );

  if (pathname === '/setup') {
    return (
      <div className="min-h-screen bg-ink font-sans text-paper">
        <InviteBanner />
        {routes}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink font-sans text-paper">
      <InviteBanner />
      <AppShell>{routes}</AppShell>
      <TabBar />
    </div>
  );
}
