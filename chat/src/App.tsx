import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { AuthContext } from './hooks/AuthContext'
import { ChatInterface } from './components/chat-interface'
import { CompoundDashboard } from './components/CompoundDashboard'
import { CompoundAccuracyScorecard } from './components/CompoundAccuracyScorecard'
import { CompoundChat } from './components/CompoundChat'
import { MarketDetail } from './components/MarketDetail'

export function App() {
  const auth = useAuth();

  if (!auth.ready) return null;

  const identity = auth.authenticated
    ? `${auth.authMode}-${auth.cortexKey?.slice(-8) || ''}`
    : 'guest';

  return (
    <AuthContext.Provider value={auth} key={identity}>
      <div className="min-h-screen bg-black">
        <Routes>
          <Route path="/" element={<ChatInterface />} />
          <Route path="/compound" element={<CompoundDashboard />} />
          <Route path="/compound/accuracy" element={<CompoundAccuracyScorecard />} />
          <Route path="/compound/chat" element={<CompoundChat />} />
          <Route path="/compound/markets/:id" element={<MarketDetail />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </AuthContext.Provider>
  );
}
