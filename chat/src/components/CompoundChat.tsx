import { Link } from 'react-router-dom';
import { MessageSquare, TrendingUp, MessageCircle } from 'lucide-react';

export function CompoundChat() {
  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Top nav */}
      <header className="border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
        <Link
          to="/compound"
          className="text-zinc-500 hover:text-zinc-300 transition-colors"
          aria-label="Back to Compound"
        >
          <TrendingUp className="h-4 w-4" />
        </Link>
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-emerald-400" />
          <span className="text-[13px] font-semibold text-zinc-100">Compound Chat</span>
        </div>
        <Link
          to="/"
          className="ml-auto text-zinc-500 hover:text-zinc-300 transition-colors"
          aria-label="Back to chat"
        >
          <MessageSquare className="h-4 w-4" />
        </Link>
      </header>

      {/* Centered content */}
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-4">
        <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800">
          <MessageCircle className="h-8 w-8 text-emerald-400" />
        </div>
        <h1 className="text-2xl font-semibold text-zinc-100">Coming Soon</h1>
        <p className="text-sm text-zinc-500 text-center max-w-xs">
          Chat with Compound's market intelligence — ask questions, explore predictions, and get insights in natural language.
        </p>
      </div>
    </div>
  );
}
