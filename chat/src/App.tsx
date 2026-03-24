import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { AuthContext } from './hooks/AuthContext'
import { ChatInterface } from './components/chat-interface'

// Lazy-load non-critical routes — keeps initial bundle focused on chat
const CompoundDashboard = lazy(() => import('./components/CompoundDashboard').then(m => ({ default: m.CompoundDashboard })))
const CompoundAccuracyScorecard = lazy(() => import('./components/CompoundAccuracyScorecard').then(m => ({ default: m.CompoundAccuracyScorecard })))
const CompoundChat = lazy(() => import('./components/CompoundChat').then(m => ({ default: m.CompoundChat })))
const MarketDetail = lazy(() => import('./components/MarketDetail').then(m => ({ default: m.MarketDetail })))

export function App() {
  const auth = useAuth();

  if (!auth.ready) return null;

  const identity = auth.authenticated
    ? `${auth.authMode}-${auth.cortexKey?.slice(-8) || ''}`
    : 'guest';

  return (
    <AuthContext.Provider value={auth} key={identity}>
      <div className="min-h-screen bg-black">
        <Suspense fallback={<div className="flex items-center justify-center min-h-screen text-zinc-500">Loading…</div>}>
          <Routes>
            <Route path="/" element={<ChatInterface />} />
            <Route path="/compound" element={<CompoundDashboard />} />
            <Route path="/compound/accuracy" element={<CompoundAccuracyScorecard />} />
            <Route path="/compound/chat" element={<CompoundChat />} />
            <Route path="/compound/markets/:id" element={<MarketDetail />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </div>
    </AuthContext.Provider>
  );
}
