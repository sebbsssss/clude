import { useState } from 'react';
import { useAuthContext } from '../hooks/AuthContext';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const CORTEX_HOST = 'https://clude.io';

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); }
        catch {
          const t = document.createElement('textarea');
          t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
          document.body.appendChild(t); t.select(); document.execCommand('copy');
          document.body.removeChild(t);
        }
        setOk(true);
        setTimeout(() => setOk(false), 2000);
      }}
      style={{
        fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 1,
        textTransform: 'uppercase', padding: '6px 14px',
        background: ok ? '#10b981' : 'var(--text)', color: 'var(--bg)',
        border: 'none', cursor: 'pointer', transition: 'background 0.2s',
        flexShrink: 0,
      }}
    >
      {ok ? 'Copied!' : label || 'Copy'}
    </button>
  );
}

function StepBadge({ n, done }: { n: number; done?: boolean }) {
  return (
    <span style={{
      width: 22, height: 22, borderRadius: '50%',
      background: done ? '#10b981' : 'var(--text)',
      color: 'var(--bg)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, fontWeight: 700, flexShrink: 0,
    }}>
      {done ? '\u2713' : n}
    </span>
  );
}

export function Setup() {
  const { authMode } = useAuthContext();
  const [agentName, setAgentName] = useState('');
  const [registering, setRegistering] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const existingKey = authMode === 'cortex' ? (localStorage.getItem('cortex_api_key') || '') : '';
  const activeKey = apiKey || existingKey;

  async function handleRegister() {
    const name = agentName.trim();
    if (!name || name.length < 2) { setError('Name must be at least 2 characters'); return; }
    setError('');
    setRegistering(true);
    try {
      const endpoint = API_BASE || CORTEX_HOST;
      const res = await fetch(`${endpoint}/api/cortex/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error || 'Registration failed';
        // Make common errors more user-friendly
        if (res.status === 409) {
          setError('This name or wallet is already registered. Try a different name, or use your existing API key in Settings.');
        } else if (res.status === 429) {
          setError('Too many attempts. Please wait a minute and try again.');
        } else {
          setError(msg);
        }
        setRegistering(false);
        return;
      }
      if (!data.apiKey) { setError('Unexpected response'); setRegistering(false); return; }
      setApiKey(data.apiKey);
    } catch { setError('Network error'); }
    finally { setRegistering(false); }
  }

  const installCmd = activeKey
    ? `CORTEX_API_KEY=${activeKey} npx clude-bot setup`
    : 'npx clude-bot setup';

  const mcpConfig = JSON.stringify({
    mcpServers: {
      'clude-memory': {
        command: 'npx', args: ['clude-bot', 'mcp-serve'],
        env: { CORTEX_API_KEY: activeKey || 'clk_...', CORTEX_HOST_URL: CORTEX_HOST },
      },
    },
  }, null, 2);

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 12 }}>
          Get Started
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, marginBottom: 8 }}>
          Setup
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          Give your agent persistent memory in 3 steps.
        </p>
      </div>

      {/* ── Step 1: Create Agent ── */}
      <div style={{ border: '1px solid var(--border)', marginBottom: 3 }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StepBadge n={1} done={!!activeKey} />
            <span style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 600 }}>
              Create Your Agent
            </span>
          </div>
          {activeKey && <span style={{ fontSize: 10, color: '#10b981', fontWeight: 600 }}>Done</span>}
        </div>
        <div style={{ padding: 20 }}>
          {activeKey ? (
            <div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px', background: 'var(--bg-warm)',
                border: '1px solid var(--border)',
              }}>
                <code style={{ fontSize: 12, flex: 1, wordBreak: 'break-all' }}>
                  {showKey ? activeKey : `${'*'.repeat(16)}${activeKey.slice(-6)}`}
                </code>
                <button onClick={() => setShowKey(!showKey)} style={{
                  fontFamily: 'var(--mono)', fontSize: 9, background: 'none',
                  border: 'none', color: 'var(--text-faint)', cursor: 'pointer',
                }}>{showKey ? 'Hide' : 'Show'}</button>
                <CopyBtn text={activeKey} />
              </div>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.7 }}>
                Pick a name. We'll create a cloud memory for your agent instantly.
              </p>
              <div style={{ display: 'flex', gap: 8, maxWidth: 400 }}>
                <input
                  type="text"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
                  placeholder="my-agent"
                  autoFocus
                  style={{
                    fontFamily: 'var(--mono)', fontSize: 12, padding: '10px 12px',
                    border: '1px solid var(--border-strong)', background: 'transparent',
                    flex: 1, outline: 'none',
                  }}
                />
                <button
                  onClick={handleRegister}
                  disabled={registering || agentName.trim().length < 2}
                  style={{
                    fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 2,
                    textTransform: 'uppercase', padding: '10px 20px',
                    background: agentName.trim().length >= 2 ? 'var(--text)' : 'var(--border-strong)',
                    color: agentName.trim().length >= 2 ? 'var(--bg)' : 'var(--text-faint)',
                    border: 'none', cursor: agentName.trim().length >= 2 ? 'pointer' : 'not-allowed',
                  }}
                >
                  {registering ? '...' : 'Create'}
                </button>
              </div>
            </div>
          )}
          {error && (
            <div style={{
              fontSize: 11, color: '#ef4444', marginTop: 12,
              padding: '10px 14px', background: 'rgba(239, 68, 68, 0.06)',
              border: '1px solid rgba(239, 68, 68, 0.15)', lineHeight: 1.6,
            }}>
              {error}
            </div>
          )}
        </div>
      </div>

      {/* ── Step 2: Copy Command ── */}
      <div style={{ border: '1px solid var(--border)', borderTop: 'none', marginBottom: 3 }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <StepBadge n={2} />
          <span style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 600 }}>
            Run This in Your Terminal
          </span>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '14px 16px', background: 'var(--bg-warm)',
            border: '1px solid var(--border)',
          }}>
            <code style={{ fontSize: 12, flex: 1, wordBreak: 'break-all', lineHeight: 1.6 }}>
              {installCmd}
            </code>
            <CopyBtn text={installCmd} />
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 10, lineHeight: 1.7 }}>
            This installs Clude and walks you through connecting it to Claude Code, Claude Desktop, or Cursor.
            It auto-detects your IDE.
          </p>
        </div>
      </div>

      {/* ── Step 3: Restart ── */}
      <div style={{ border: '1px solid var(--border)', borderTop: 'none', marginBottom: 24 }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <StepBadge n={3} />
          <span style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 600 }}>
            Restart Your IDE
          </span>
        </div>
        <div style={{ padding: 20 }}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.8 }}>
            That's it. Your agent now has 4 memory tools:
          </p>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
            marginTop: 14,
          }}>
            {[
              { name: 'recall_memories', desc: 'Search past memories' },
              { name: 'store_memory', desc: 'Save new memories' },
              { name: 'get_memory_stats', desc: 'View memory stats' },
              { name: 'find_clinamen', desc: 'Find unexpected connections' },
            ].map(t => (
              <div key={t.name} style={{
                padding: '10px 12px', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <code style={{ fontSize: 10, fontWeight: 600 }}>{t.name}</code>
                <span style={{ fontSize: 9, color: 'var(--text-faint)' }}>{t.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Use Your Key Elsewhere ── */}
      {activeKey && (
        <div style={{ border: '1px solid var(--border)', marginBottom: 24 }}>
          <div style={{
            padding: '16px 20px', borderBottom: '1px solid var(--border)',
            fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 600,
          }}>
            Use Your Key Elsewhere
          </div>
          <div style={{ padding: 20 }}>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.7 }}>
              You can also use your API key with:
            </p>
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{
                padding: '14px 16px', border: '1px solid var(--border)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>OpenClaw</div>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>Add as an agent skill — set <code>CORTEX_API_KEY</code> in your environment</div>
                </div>
                <CopyBtn text={`CORTEX_API_KEY=${activeKey}`} label="Copy Env" />
              </div>
              <div style={{
                padding: '14px 16px', border: '1px solid var(--border)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>Node.js SDK</div>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)' }}><code>npm install clude-bot</code> — use the Cortex SDK in your own agent</div>
                </div>
                <CopyBtn text="npm install clude-bot" label="Copy" />
              </div>
              <div style={{
                padding: '14px 16px', border: '1px solid var(--border)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>REST API</div>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>Use from any language — pass <code>Authorization: Bearer {'{key}'}</code></div>
                </div>
                <CopyBtn text={`curl -H "Authorization: Bearer ${activeKey}" ${CORTEX_HOST}/api/cortex/stats`} label="Copy curl" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Advanced: Manual Config ── */}
      <details
        open={showAdvanced}
        onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
        style={{ border: '1px solid var(--border)' }}
      >
        <summary style={{
          padding: '14px 20px', cursor: 'pointer',
          fontSize: 10, letterSpacing: 2, textTransform: 'uppercase',
          color: 'var(--text-faint)', fontWeight: 600,
          listStyle: 'none',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 12, transition: 'transform 0.2s', transform: showAdvanced ? 'rotate(90deg)' : 'none' }}>
            {'\u25B8'}
          </span>
          Manual MCP Config (Advanced)
        </summary>
        <div style={{ padding: '0 20px 20px' }}>
          <p style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 12, lineHeight: 1.7 }}>
            If you prefer to configure manually, paste this JSON into your IDE's config file.
          </p>
          <div style={{
            fontSize: 10, color: 'var(--text-muted)', marginBottom: 4,
          }}>
            <strong>Claude Desktop</strong>: ~/Library/Application Support/Claude/claude_desktop_config.json
          </div>
          <div style={{
            fontSize: 10, color: 'var(--text-muted)', marginBottom: 4,
          }}>
            <strong>Cursor</strong>: ~/.cursor/mcp.json
          </div>
          <div style={{
            fontSize: 10, color: 'var(--text-muted)', marginBottom: 12,
          }}>
            <strong>Claude Code</strong>: .mcp.json in your project root
          </div>
          <div style={{ border: '1px solid var(--border)' }}>
            <div style={{
              padding: '8px 14px', borderBottom: '1px solid var(--border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-faint)' }}>json</span>
              <CopyBtn text={mcpConfig} label="Copy" />
            </div>
            <pre style={{
              padding: 14, fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 1.6,
              background: 'var(--bg-warm)', overflow: 'auto', maxHeight: 200,
              margin: 0, whiteSpace: 'pre',
            }}>
              {mcpConfig}
            </pre>
          </div>
        </div>
      </details>
    </div>
  );
}
