import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { AuthContext } from './hooks/AuthContext';
import { Layout } from './components/Layout';
import { Landing } from './pages/Landing';
import { Dashboard } from './pages/Dashboard';
import { Timeline } from './pages/Timeline';
import { EntityMap } from './pages/EntityMap';
import { BrainView } from './pages/BrainView';
import { DecayHeatmap } from './pages/DecayHeatmap';
import { MemoryPacks } from './pages/MemoryPacks';
import { Settings } from './pages/Settings';

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

  return (
    <AuthContext.Provider value={auth}>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/timeline" element={<Timeline />} />
          <Route path="/entities" element={<EntityMap />} />
          <Route path="/brain" element={<BrainView />} />
          <Route path="/decay" element={<DecayHeatmap />} />
          <Route path="/packs" element={<MemoryPacks />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </AuthContext.Provider>
  );
}
