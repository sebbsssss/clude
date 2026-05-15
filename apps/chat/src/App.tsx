import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import { AuthContext } from "./hooks/AuthContext";
import { V2App } from "./v2/V2App";

export function App() {
  const auth = useAuth();

  if (!auth.ready)
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-black text-zinc-500 gap-3">
        <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
        <span className="text-xs tracking-[0.3em] uppercase text-zinc-600">
          CLUDE
        </span>
      </div>
    );

  const identity = auth.authenticated
    ? `${auth.authMode}-${auth.cortexKey?.slice(-8) || ""}`
    : "guest";

  return (
    <AuthContext.Provider value={auth} key={identity}>
      <div className="h-screen overflow-hidden">
        <Routes>
          <Route path="/" element={<V2App />} />
          <Route path="/v2" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </AuthContext.Provider>
  );
}
