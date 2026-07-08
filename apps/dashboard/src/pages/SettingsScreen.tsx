import { useEffect, useState, type CSSProperties } from 'react';
import { api } from '../lib/api';
import { useAuthContext } from '../hooks/AuthContext';
import { useTheme } from '../hooks/useTheme';

/**
 * Settings — account and connection in one place: identity (email / wallet /
 * API key / endpoint), connected agent, MCP & IDE integration config, theme,
 * sign out. Folds in the old Setup page's agent-registration entry point.
 *
 * Every value is real: identity reads the auth context + localStorage, the
 * agent line pulls a live memory count from the cortex stats endpoint, and the
 * integration block emits the actual Clude remote-connector commands.
 */

const MCP_URL = 'https://mcp.clude.io/api/mcp';
const DEFAULT_ENDPOINT = 'https://clude.io';
const PULSE = '#10b981';
const DANGER = '#ef6363';

type McpTarget = 'desktop' | 'code' | 'cursor';

/** Shorten a Solana address to head…tail; passthrough if already short. */
function truncateWallet(addr: string | null): string {
  if (!addr) return 'Not connected';
  if (addr.length <= 13) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-5)}`;
}

/** Mask an API key as clude_sk_••••••<last4>; never reveals the body. */
function maskKey(key: string | null): string {
  if (!key) return 'Not set';
  const last4 = key.slice(-4);
  return `clude_sk_••••••${last4}`;
}

export function SettingsScreen() {
  const { email, walletAddress, logout } = useAuthContext();
  const { isDark, toggle } = useTheme();

  const [mcp, setMcp] = useState<McpTarget>('desktop');
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  const [copied, setCopied] = useState<'' | 'config' | 'install'>('');

  // Read the persisted Cortex credentials once on mount (localStorage is sync,
  // but reading inside an effect keeps render pure and SSR-safe).
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [endpoint, setEndpoint] = useState<string>(DEFAULT_ENDPOINT);

  useEffect(() => {
    setApiKey(localStorage.getItem('cortex_api_key'));
    setEndpoint(localStorage.getItem('cortex_endpoint') || DEFAULT_ENDPOINT);
  }, []);

  // Live memory count for the connected-agent summary; degrade silently.
  useEffect(() => {
    let live = true;
    api.getStats()
      .then((s) => { if (live) setMemoryCount(s.total); })
      .catch(() => { /* leave null → wallet-only summary */ });
    return () => { live = false; };
  }, []);

  const mcpText = mcp === 'code'
    ? `claude mcp add --transport http --scope user clude ${MCP_URL}`
    : JSON.stringify({ mcpServers: { clude: { url: MCP_URL } } }, null, 2);

  const installCmd = 'npx @clude/sdk setup';

  async function copy(text: string, which: 'config' | 'install') {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for insecure contexts / older browsers.
      const t = document.createElement('textarea');
      t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch { /* noop */ }
      document.body.removeChild(t);
    }
    setCopied(which);
    setTimeout(() => setCopied((c) => (c === which ? '' : c)), 1500);
  }

  const agentSummary = memoryCount != null
    ? `Connected agent · ${memoryCount.toLocaleString()} memories · ${truncateWallet(walletAddress)}`
    : `Connected agent · ${truncateWallet(walletAddress)}`;

  return (
    <div style={{ overflowY: 'auto', height: '100%' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '28px 36px 80px' }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-3)', marginBottom: 9 }}>Settings</div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--fg)' }}>Account &amp; connection</h1>
        </div>

        {/* ── Identity ── */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '6px 24px', marginBottom: 18 }}>
          <IdentityRow label="Email" value={email || 'Not linked'} />
          <IdentityRow label="Wallet" sub="Privy · Solana" value={truncateWallet(walletAddress)} />
          <IdentityRow label="API key" value={maskKey(apiKey)} />
          <IdentityRow label="Endpoint" value={endpoint} last />
        </div>

        {/* ── Connected agent ── */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 24px', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Connected agent</div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: PULSE, background: 'rgba(16,185,129,0.14)', padding: '3px 9px', borderRadius: 6 }}>
              <span className="cl-pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: PULSE }} />Live
            </span>
          </div>
          <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.5 }}>{agentSummary}</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {/* Both are no-ops for now: agent registration was folded into this
                screen, and key rotation has no client endpoint yet. They stay
                visible per the design and degrade gracefully. */}
            <button className="gbtn" onClick={() => { /* TODO: wire key rotation */ }} style={ghostBtn}>Rotate key</button>
            <button className="gbtn" onClick={() => { /* TODO: wire agent registration */ }} style={ghostBtn}>Register another agent</button>
          </div>
        </div>

        {/* ── MCP & IDE integration ── */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 24px', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>MCP &amp; IDE integration</div>
              <p style={{ margin: '5px 0 0', fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.5 }}>Give Clude memory to your tools.</p>
            </div>
            <div style={{ display: 'flex', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 9, padding: 3 }}>
              <SegBtn active={mcp === 'desktop'} onClick={() => setMcp('desktop')}>Claude Desktop</SegBtn>
              <SegBtn active={mcp === 'code'} onClick={() => setMcp('code')}>Claude Code</SegBtn>
              <SegBtn active={mcp === 'cursor'} onClick={() => setMcp('cursor')}>Cursor</SegBtn>
            </div>
          </div>
          <div style={{ position: 'relative', background: '#0b0b10', border: '1px solid var(--border)', borderRadius: 11, padding: '16px 18px' }}>
            <button
              className="pbtn"
              onClick={() => copy(mcpText, 'config')}
              style={{ position: 'absolute', top: 12, right: 12, fontSize: 10.5, fontWeight: 600, fontFamily: 'var(--mono)', color: '#cfd0e0', background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}
            >
              {copied === 'config' ? 'Copied' : 'Copy'}
            </button>
            <pre style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.6, color: '#c9cbe0', whiteSpace: 'pre-wrap', overflowX: 'auto' }}>{mcpText}</pre>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12.5, color: 'var(--fg-3)' }}>$</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12.5, color: 'var(--fg)', flex: 1 }}>{installCmd}</span>
            <button
              className="pbtn"
              onClick={() => copy(installCmd, 'install')}
              style={{ fontSize: 10.5, fontWeight: 600, fontFamily: 'var(--mono)', color: 'var(--accent-text)', background: 'var(--accent-soft)', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}
            >
              {copied === 'install' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        {/* ── Appearance ── */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 24px', marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>Appearance</div>
            <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2 }}>Dark-first, light is the clean inverse.</div>
          </div>
          <div style={{ display: 'flex', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 9, padding: 3, width: 160 }}>
            <SegBtn active={isDark} onClick={() => { if (!isDark) toggle(); }} grow>Dark</SegBtn>
            <SegBtn active={!isDark} onClick={() => { if (isDark) toggle(); }} grow>Light</SegBtn>
          </div>
        </div>

        {/* ── Sign out ── */}
        <button
          className="gbtn"
          onClick={() => logout()}
          style={{ fontSize: 12.5, fontWeight: 600, color: DANGER, background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 9, padding: '10px 16px', cursor: 'pointer' }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

const ghostBtn: CSSProperties = {
  fontSize: 12.5, fontWeight: 600, color: 'var(--fg-2)', background: 'transparent',
  border: '1px solid var(--border-2)', borderRadius: 9, padding: '9px 14px', cursor: 'pointer',
};

function IdentityRow({ label, value, sub, last }: { label: string; value: string; sub?: string; last?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '16px 0', borderBottom: last ? 'none' : '1px solid var(--hairline)' }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--fg-2)', textAlign: 'right', wordBreak: 'break-all' }}>{value}</div>
    </div>
  );
}

function SegBtn({ active, onClick, children, grow }: { active: boolean; onClick: () => void; children: React.ReactNode; grow?: boolean }) {
  return (
    <button
      className="pbtn"
      onClick={onClick}
      style={{
        flex: grow ? 1 : 'none',
        fontSize: 12, fontWeight: active ? 600 : 500,
        color: active ? 'var(--accent-text)' : 'var(--fg-2)',
        background: active ? 'var(--accent-soft)' : 'transparent',
        border: 'none', borderRadius: 7, padding: '6px 13px', cursor: 'pointer',
        whiteSpace: 'nowrap', transition: 'background .12s, color .12s',
      }}
    >
      {children}
    </button>
  );
}
