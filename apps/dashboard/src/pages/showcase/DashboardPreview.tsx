import { WikiSummaryCard } from '../../components/WikiSummaryCard';

// Public-route preview of just the WikiSummaryCard, so the integration into
// the Dashboard root can be reviewed without authentication.
export default function DashboardPreview() {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      color: 'var(--text)',
      padding: '40px',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{
          fontFamily: 'var(--mono)',
          fontSize: 11,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--text-faint)',
          marginBottom: 8,
        }}>
          Preview · Dashboard root with the new Brain Wiki card
        </div>
        <h1 style={{
          fontSize: 26,
          fontWeight: 700,
          marginTop: 0,
          marginBottom: 24,
        }}>
          Welcome back
        </h1>
        <WikiSummaryCard />
        <div style={{
          padding: 24,
          border: '1px dashed var(--border)',
          borderRadius: 6,
          color: 'var(--text-faint)',
          fontSize: 13,
          textAlign: 'center',
        }}>
          ↓ The existing analytics bento grid (Activity Feed, NeuralCanvas, stats tiles) renders below this card on the real dashboard.
        </div>
      </div>
    </div>
  );
}
