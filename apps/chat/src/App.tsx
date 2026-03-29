import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { AuthContext } from './hooks/AuthContext'
import { ChatInterface } from './components/chat-interface'

// Lazy-load non-critical routes — keeps initial bundle focused on chat
// Compound routes disabled (COMPOUND_ENABLED=false) — kept for future re-enable
// const CompoundDashboard = lazy(() => import('./components/CompoundDashboard').then(m => ({ default: m.CompoundDashboard })))
// const CompoundAccuracyScorecard = lazy(() => import('./components/CompoundAccuracyScorecard').then(m => ({ default: m.CompoundAccuracyScorecard })))
// const CompoundChat = lazy(() => import('./components/CompoundChat').then(m => ({ default: m.CompoundChat })))
// const MarketDetail = lazy(() => import('./components/MarketDetail').then(m => ({ default: m.MarketDetail })))

export function App() {
  const auth = useAuth();

  if (!auth.ready) return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black text-zinc-500 gap-3">
      <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
      <span className="text-xs tracking-[0.3em] uppercase text-zinc-600">CLUDE</span>
    </div>
  );

  const identity = auth.authenticated
    ? `${auth.authMode}-${auth.cortexKey?.slice(-8) || ''}`
    : 'guest';

  return (
    <AuthContext.Provider value={auth} key={identity}>
      <div className="min-h-screen bg-black">
        <Suspense fallback={<div className="flex items-center justify-center min-h-screen text-zinc-500">Loading…</div>}>
          <Routes>
            <Route path="/" element={<ChatInterface />} />
            {/* Compound routes disabled — redirect to home */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </div>
    </AuthContext.Provider>
  );
}
