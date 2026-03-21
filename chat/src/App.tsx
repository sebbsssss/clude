import { useAuth } from './hooks/useAuth'
import { AuthContext } from './hooks/AuthContext'
import { ChatInterface } from './components/chat-interface'

export function App() {
  const auth = useAuth();

  if (!auth.ready) return null;

  const identity = auth.authenticated
    ? `${auth.authMode}-${auth.cortexKey?.slice(-8) || ''}`
    : 'guest';

  return (
    <AuthContext.Provider value={auth} key={identity}>
      <div className="min-h-screen bg-black">
        <ChatInterface />
      </div>
    </AuthContext.Provider>
  );
}
