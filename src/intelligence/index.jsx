import { useMemo } from 'react';
import './intelligence.css';
import { DashboardProvider } from './data/DashboardContext';
import { ToastProvider } from './ui/Toast';
import { useRoute } from './data/useRoute';
import { useResource } from './data/useResource';
import { monitoringApi } from './data/api';
import Layout from './shell/Layout';
import Overview from './pages/Overview';
import Applications from './pages/Applications';
import ApplicationDetail from './pages/ApplicationDetail';
import SystemHealth from './pages/SystemHealth';
import Settings from './pages/Settings';
import SecretsSubscriptions from './pages/SecretsSubscriptions';
import { StateMessage } from './ui/StateMessage';
import LoginScreen from './components/LoginScreen';
import { useSignedIn, useRole } from './data/auth';
import Showcase from './pages/Showcase';
import { sampleScenario } from './data/api';
import { LinkButton } from './ui/primitives';
import { hrefTo } from './data/useRoute';

function Console() {
  const route = useRoute();
  const summaryRes = useResource((s) => monitoringApi.summary(s), []);
  const appsRes = useResource((s) => monitoringApi.applications(s), []);
  const [section = '', id] = route.parts;

  const lastSuccessAt = useMemo(() => {
    const list = (appsRes.data && appsRes.data.applications) || [];
    return list.reduce((best, a) => (a.lastSuccessAt && (!best || a.lastSuccessAt > best) ? a.lastSuccessAt : best), null);
  }, [appsRes.data]);

  let page;
  if (section === '') page = <Overview summaryRes={summaryRes} appsRes={appsRes} route={route} />;
  else if (section === 'applications' && id) page = <ApplicationDetail key={id} id={id} appsRes={appsRes} summaryRes={summaryRes} />;
  else if (section === 'applications') page = <Applications summaryRes={summaryRes} appsRes={appsRes} route={route} />;
  else if (section === 'health') page = <SystemHealth summaryRes={summaryRes} appsRes={appsRes} route={route} />;
  else if (section === 'secrets') page = <SecretsSubscriptions route={route} />;
  else if (section === 'settings') page = <Settings summaryRes={summaryRes} appsRes={appsRes} />;
  else page = <StateMessage icon="search" title="Page not found" action={<LinkButton variant="primary" href={hrefTo('')}>Go to overview</LinkButton>}>This page does not exist in the console.</StateMessage>;

  return <Layout section={section} summary={summaryRes.data} lastSuccessAt={lastSuccessAt}>{page}</Layout>;
}

// Nothing is requested, and no console UI is shown, until the owner has signed in. If the server later
// answers 401 (expired or revoked session) the stored session is cleared and this screen returns.
function AuthGate() {
  const signedIn = useSignedIn();
  const sample = Boolean(sampleScenario()); // development fixtures only (stripped from production builds)
  const role = useRole();
  if (!signedIn && !sample) return <LoginScreen />;
  if (role === 'viewer') return <Showcase />;
  return <Console />;
}

export default function IntelligenceApp() {
  return (
    <div className="ai-root">
      <DashboardProvider>
        <ToastProvider>
          <AuthGate />
        </ToastProvider>
      </DashboardProvider>
    </div>
  );
}
