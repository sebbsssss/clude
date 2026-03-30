import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { AuthContext } from './hooks/AuthContext';
import { AgentProvider } from './context/AgentContext';
import { Layout } from './components/Layout';
import { Landing } from './pages/Landing';
import { Dashboard } from './pages/Dashboard';
import { Timeline } from './pages/Timeline';
import { EntityMap } from './pages/EntityMap';
import { BrainView } from './pages/BrainView';
import { DecayHeatmap } from './pages/DecayHeatmap';
import { MemoryPacks } from './pages/MemoryPacks';
import { Settings } from './pages/Settings';
import { Setup } from './pages/Setup';
import { FileMemory } from './pages/file-memory';
import { Explore } from './pages/explore';

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
