import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { MemoryStats } from '../types/memory';

export function Dashboard() {
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [veniceStats, setVeniceStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getStats().catch(() => null),
      api.getVeniceStats().catch(() => null),
    ]).then(([s, v]) => {
      setStats(s);
      setVeniceStats(v);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div style={{ marginBottom: 48 }}>
        <div style={{ fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 12 }}>
          Dashboard
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>
          Agent Memory Overview
        </h1>
      </div>

      {/* Stats Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 1,
        background: 'var(--border)',
        border: '1px solid var(--border)',
        marginBottom: 40,
      }}>
        <StatCard label="Total Memories" value={stats?.total || 0} />
        <StatCard label="Episodic" value={stats?.byType.episodic || 0} color="var(--episodic)" />
        <StatCard label="Semantic" value={stats?.byType.semantic || 0} color="var(--semantic)" />
        <StatCard label="Procedural" value={stats?.byType.procedural || 0} color="var(--procedural)" />
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 1,
        background: 'var(--border)',
        border: '1px solid var(--border)',
        marginBottom: 40,
      }}>
        <StatCard label="Self-Model" value={stats?.byType.self_model || 0} color="var(--self-model)" />
        <StatCard label="Dream Sessions" value={stats?.totalDreamSessions || 0} />
        <StatCard label="Unique Users" value={stats?.uniqueUsers || 0} />
        <StatCard label="Avg Importance" value={(stats?.avgImportance || 0).toFixed(2)} />
      </div>

      {/* Venice Stats */}
      {veniceStats && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 1,
          background: 'var(--border)',
          border: '1px solid var(--border)',
          marginBottom: 40,
        }}>
          <StatCard
            label="Venice Calls"
            value={veniceStats.venice?.totalInferenceCalls || 0}
            sublabel="Private inference"
          />
          <StatCard
            label="Tokens Processed"
            value={formatTokens(veniceStats.venice?.totalTokensProcessed || 0)}
            sublabel="Zero data retention"
          />
          <StatCard
            label="On-Chain"
            value={veniceStats.decentralization?.totalMemoriesOnChain || 0}
            sublabel="Solana verified"
          />
        </div>
      )}

      {/* Quick Links */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 1,
        background: 'var(--border)',
        border: '1px solid var(--border)',
      }}>
        <QuickLink to="/timeline" icon="▤" title="Memory Timeline" desc="Browse memories chronologically" />
        <QuickLink to="/entities" icon="◎" title="Entity Map" desc="People, concepts, relationships" />
        <QuickLink to="/brain" icon="◈" title="Brain View" desc="Interactive memory graph" />
      </div>

      {/* Top Tags & Concepts */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 40 }}>
          <div style={{ border: '1px solid var(--border)', padding: 24 }}>
            <div style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 16 }}>
              Top Tags
            </div>
            {stats.topTags.slice(0, 8).map((t) => (
              <div key={t.tag} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                <span>{t.tag}</span>
                <span style={{ color: 'var(--text-faint)' }}>{t.count}</span>
              </div>
            ))}
          </div>
          <div style={{ border: '1px solid var(--border)', padding: 24 }}>
            <div style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 16 }}>
              Top Concepts
            </div>
            {stats.topConcepts.slice(0, 8).map((c) => (
              <div key={c.concept} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                <span>{c.concept}</span>
                <span style={{ color: 'var(--text-faint)' }}>{c.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color, sublabel }: {
  label: string;
  value: string | number;
  color?: string;
  sublabel?: string;
}) {
  return (
    <div style={{ background: 'var(--bg)', padding: '28px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 800, color: color || 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-faint)', marginTop: 6 }}>
        {label}
      </div>
      {sublabel && (
        <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 4 }}>{sublabel}</div>
      )}
    </div>
  );
}

function QuickLink({ to, icon, title, desc }: {
  to: string;
  icon: string;
  title: string;
  desc: string;
}) {
  return (
    <Link to={to} style={{
      background: 'var(--bg)',
      padding: '32px 24px',
      textDecoration: 'none',
      color: 'var(--text)',
      transition: 'background 0.15s',
    }}>
      <div style={{ fontSize: 24, marginBottom: 12, opacity: 0.3 }}>{icon}</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{desc}</div>
    </Link>
  );
}

function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}
