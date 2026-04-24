import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { AuthContext } from './hooks/AuthContext';
import { AgentProvider } from './context/AgentContext';
import { Layout } from './components/Layout';
import { Landing } from './pages/Landing';
import { Dashboard } from './pages/Dashboard';
import { Timeline } from './pages/Timeline';
import { EntityMap } from './pages/EntityMap';
import { DecayHeatmap } from './pages/DecayHeatmap';
import { MemoryPacks } from './pages/MemoryPacks';
import { Settings } from './pages/Settings';
import { Setup } from './pages/Setup';
import { FileMemory } from './pages/file-memory';
import { Explore } from './pages/explore';
import LiveGraph from './pages/showcase/LiveGraph';

function AuthenticatedApp() {
  return (
    <AgentProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/timeline" element={<Timeline />} />
          <Route path="/entities" element={<EntityMap />} />
          <Route path="/brain" element={<Explore />} />
          <Route path="/decay" element={<DecayHeatmap />} />
          <Route path="/packs" element={<MemoryPacks />} />
          <Route path="/file-memory" element={<FileMemory />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/settings" element={<Settings />} />
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
