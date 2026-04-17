import { useEffect, useState } from 'react';

interface KPISnapshot {
  window_start: string;
  window_end: string;
  sdk_installs_total: number;
  sdk_installs_unique_wallets: number;
  recall_calls: number;
  store_calls: number;
  returning_7d: number;
  per_channel: Record<string, { installs: number; returning: number }>;
  attribution_confidence: 'low' | 'medium' | 'high';
  notes: string[];
  created_at: string;
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

export function Growth() {
  const [snapshots, setSnapshots] = useState<KPISnapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/growth/snapshots?limit=12')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data: { snapshots: KPISnapshot[] }) => setSnapshots(data.snapshots || []))
      .catch((err: Error) => setError(err.message));
  }, []);

  const latest = snapshots && snapshots.length > 0 ? snapshots[0] : null;

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '48px 24px', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 8 }}>Clude growth — honest numbers</h1>
      <p style={{ color: '#666', marginBottom: 32, lineHeight: 1.5 }}>
        Real activations only. Bot owner wallet and benchmark sources excluded.
        Attribution confidence is explicit per snapshot.
        If a number looks bad here, it means the number is bad. That's the point.
      </p>

      {error && (
        <div style={{ padding: 16, background: '#fee', borderRadius: 8, marginBottom: 24 }}>
          Failed to load: {error}
        </div>
      )}

      {!error && !snapshots && <p style={{ color: '#888' }}>Loading…</p>}

      {latest && (
        <div style={{ border: '1px solid #eee', borderRadius: 12, padding: 24, marginBottom: 24 }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
            {fmtDate(latest.window_start)} → {fmtDate(latest.window_end)} · attribution: {latest.attribution_confidence}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
            <Stat label="Unique wallets (install proxy)" value={latest.sdk_installs_unique_wallets} />
            <Stat label="Store calls" value={latest.store_calls} />
            <Stat label="Returning (WoW)" value={latest.returning_7d} />
          </div>
          {latest.notes.length > 0 && (
            <ul style={{ marginTop: 16, paddingLeft: 20, color: '#555', fontSize: 13 }}>
              {latest.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}
        </div>
      )}

      {snapshots && snapshots.length > 1 && (
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>History</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #eee' }}>
                <th style={{ padding: '8px 4px' }}>Window end</th>
                <th style={{ padding: '8px 4px' }}>Wallets</th>
                <th style={{ padding: '8px 4px' }}>Store</th>
                <th style={{ padding: '8px 4px' }}>Returning</th>
                <th style={{ padding: '8px 4px' }}>Attribution</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map(s => (
                <tr key={s.created_at} style={{ borderBottom: '1px solid #f5f5f5' }}>
                  <td style={{ padding: '8px 4px' }}>{fmtDate(s.window_end)}</td>
                  <td style={{ padding: '8px 4px' }}>{s.sdk_installs_unique_wallets}</td>
                  <td style={{ padding: '8px 4px' }}>{s.store_calls}</td>
                  <td style={{ padding: '8px 4px' }}>{s.returning_7d}</td>
                  <td style={{ padding: '8px 4px' }}>{s.attribution_confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {snapshots && snapshots.length === 0 && (
        <p style={{ color: '#888' }}>No snapshots yet. The Analyst runs every 6 hours.</p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div style={{ fontSize: 28, fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: 12, color: '#666' }}>{label}</div>
    </div>
  );
}
