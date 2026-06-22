import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { AuthContext } from './hooks/AuthContext';
import { AgentProvider } from './context/AgentContext';
import { Layout } from './components/Layout';
import { Landing } from './pages/Landing';
import { Overview } from './pages/Overview';
import { ExploreScreen } from './pages/ExploreScreen';
import { WikiScreen } from './pages/WikiScreen';
import { ExportScreen } from './pages/ExportScreen';
import { SettingsScreen } from './pages/SettingsScreen';
// Kept for the public /showcase routes (separate from the signed-in app).
import { WikiPacks } from './pages/WikiPacks';
import { Wiki } from './pages/Wiki/Wiki';
import LiveGraph from './pages/showcase/LiveGraph';
import DashboardPreview from './pages/showcase/DashboardPreview';

function AuthenticatedApp() {
  return (
    <AgentProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/explore" element={<ExploreScreen />} />
          <Route path="/wiki" element={<WikiScreen />} />
          <Route path="/export" element={<ExportScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          {/* Legacy paths → their new home, so nothing 404s. */}
          <Route path="/timeline" element={<Navigate to="/explore" replace />} />
          <Route path="/entities" element={<Navigate to="/explore" replace />} />
          <Route path="/brain" element={<Navigate to="/explore" replace />} />
          <Route path="/decay" element={<Navigate to="/explore" replace />} />
          <Route path="/packs" element={<Navigate to="/export" replace />} />
          <Route path="/wiki-packs" element={<Navigate to="/wiki" replace />} />
          <Route path="/file-memory" element={<Navigate to="/export" replace />} />
          <Route path="/setup" element={<Navigate to="/settings" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </AgentProvider>
  );
}

export default function App() {
  const auth = useAuth();
  const location = useLocation();

  // Public showcase routes — no auth required, bypasses Landing.
  // Judges / general visitors land here without needing a wallet.
  if (location.pathname.startsWith('/showcase')) {
    return (
      <Routes>
        <Route path="/showcase/graph" element={<LiveGraph />} />
        <Route path="/showcase/wiki" element={<Wiki showcase />} />
        <Route path="/showcase/dashboard" element={<DashboardPreview />} />
        <Route path="/showcase/packs" element={
          <div style={{
            minHeight: '100vh',
            background: 'var(--bg)',
            color: 'var(--text)',
            padding: '40px',
          }}>
            <WikiPacks />
          </div>
        } />
        <Route path="/showcase/*" element={<Navigate to="/showcase/graph" replace />} />
      </Routes>
    );
  }

  if (!auth.ready) return null;

  if (!auth.authenticated) {
    return (
      <AuthContext.Provider value={auth}>
        <Landing />
      </AuthContext.Provider>
    );
  }

  // Unique key per auth session — forces full unmount/remount of all children
  // when switching between wallet and API key login
  const identity = auth.authMode === 'cortex'
    ? `cortex-${localStorage.getItem('cortex_api_key')?.slice(-8) || ''}`
    : `privy-${auth.walletAddress || ''}`;

  return (
    <AuthContext.Provider value={auth} key={identity}>
      <AuthenticatedApp />
    </AuthContext.Provider>
  );
}
