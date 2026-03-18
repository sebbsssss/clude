import { useState } from 'react';
import { useAuthContext } from '../hooks/AuthContext';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const CORTEX_HOST = 'https://clude.io';

type Step = 'name' | 'ready' | 'install';
type IDE = 'claude-desktop' | 'claude-code' | 'cursor';

interface RegistrationResult {
  apiKey: string;
  agentId: string;
  wallet: string | null;
}

function getMcpConfig(apiKey: string): string {
  const entry = {
    command: 'npx',
    args: ['clude-bot', 'mcp-serve'],
    env: {
      CORTEX_API_KEY: apiKey,
      CORTEX_HOST_URL: CORTEX_HOST,
    },
  };
  return JSON.stringify({ mcpServers: { 'clude-memory': entry } }, null, 2);
}

function getConfigPath(ide: IDE): string {
  switch (ide) {
    case 'claude-desktop':
      return '~/Library/Application Support/Claude/claude_desktop_config.json';
    case 'claude-code':
      return '.mcp.json (project root)';
    case 'cursor':
      return '~/.cursor/mcp.json';
  }
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Fallback for non-HTTPS or permission-denied contexts
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
      }}
      style={{
        fontFamily: 'var(--mono)',
        fontSize: 10,
        letterSpacing: 1,
        textTransform: 'uppercase',
        padding: '6px 14px',
        background: copied ? '#10b981' : 'var(--text)',
        color: 'var(--bg)',
        border: 'none',
        cursor: 'pointer',
        transition: 'background 0.2s',
      }}
    >
      {copied ? 'Copied!' : label || 'Copy'}
    </button>
  );
}

export function CloudSetup({ onBack }: { onBack: () => void }) {
  const { loginWithApiKey } = useAuthContext();
  const [step, setStep] = useState<Step>('name');
  const [agentName, setAgentName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [selectedIde, setSelectedIde] = useState<IDE>('claude-code');
  const [showKey, setShowKey] = useState(false);

  function handleBack() {
    // Reset all state so re-entering the wizard is clean
    setStep('name');
    setAgentName('');
    setError('');
    setLoading(false);
    setResult(null);
    setShowKey(false);
    setSelectedIde('claude-code');
    onBack();
  }

  async function handleRegister() {
    const name = agentName.trim();
    if (!name || name.length < 2) {
      setError('Agent name must be at least 2 characters');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const endpoint = API_BASE || CORTEX_HOST;
      const res = await fetch(`${endpoint}/api/cortex/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          setError('This name or wallet is already registered. Try a different name, or sign in with your existing API key.');
        } else if (res.status === 429) {
          setError('Too many attempts. Please wait a minute and try again.');
        } else {
          setError(data.error || 'Registration failed');
        }
        setLoading(false);
        return;
      }

      if (!data.apiKey || !data.agentId) {
        setError('Unexpected server response — missing API key or agent ID');
        setLoading(false);
        return;
      }

      setResult(data);
      setStep('ready');

      // Auto-login with the new key
      const cortexEndpoint = API_BASE || CORTEX_HOST;
      await loginWithApiKey(data.apiKey, cortexEndpoint !== CORTEX_HOST ? cortexEndpoint : undefined);
    } catch {
      setError('Network error — could not reach the server');
    } finally {
      setLoading(false);
    }
  }

  const ides: { id: IDE; label: string; desc: string }[] = [
    { id: 'claude-code', label: 'Claude Code', desc: 'CLI / VS Code' },
    { id: 'claude-desktop', label: 'Claude Desktop', desc: 'macOS / Windows' },
    { id: 'cursor', label: 'Cursor', desc: 'AI IDE' },
  ];

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
    }}>
      <div style={{ maxWidth: 520, width: '100%' }}>
        {/* Header */}
        <div style={{ marginBottom: 40, textAlign: 'center' }}>
          <div style={{
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: 5,
            textTransform: 'uppercase' as const,
            marginBottom: 8,
          }}>
            CLUDE
          </div>
          <div style={{
            fontSize: 10,
            letterSpacing: 2,
            textTransform: 'uppercase' as const,
            color: 'var(--text-faint)',
          }}>
            Cloud Setup
          </div>
        </div>

        {/* Progress */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 8,
          marginBottom: 40,
        }}>
          {['name', 'ready', 'install'].map((s, i) => (
            <div
              key={s}
              style={{
                width: 48,
                height: 2,
                background: ['name', 'ready', 'install'].indexOf(step) >= i
                  ? 'var(--text)'
                  : 'var(--border-strong)',
                transition: 'background 0.3s',
              }}
            />
          ))}
        </div>

        {/* Step 1: Agent Name */}
        {step === 'name' && (
          <div className="fade-in">
            <h2 style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: -0.5,
              marginBottom: 8,
              textAlign: 'center',
            }}>
              Name your agent
            </h2>
            <p style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              textAlign: 'center',
              marginBottom: 32,
              lineHeight: 1.7,
            }}>
              This creates a cloud-hosted memory cortex for your agent.<br />
              No infrastructure needed — works instantly.
            </p>

            <div style={{ maxWidth: 360, margin: '0 auto' }}>
              <label style={{
                display: 'block',
                fontSize: 10,
                letterSpacing: 1,
                textTransform: 'uppercase',
                color: 'var(--text-faint)',
                marginBottom: 6,
              }}>
                Agent Name
              </label>
              <input
                type="text"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
                placeholder="my-agent"
                autoFocus
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 14,
                  padding: '12px 14px',
                  border: '1px solid var(--border-strong)',
                  background: 'transparent',
                  width: '100%',
                  outline: 'none',
                  marginBottom: 8,
                }}
              />
              <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 20 }}>
                2+ characters. This identifies your agent in the system.
              </div>

              {error && (
                <div style={{
                  fontSize: 11,
                  color: '#ef4444',
                  marginBottom: 16,
                  padding: '8px 12px',
                  background: 'rgba(239, 68, 68, 0.06)',
                  border: '1px solid rgba(239, 68, 68, 0.15)',
                }}>
                  {error}
                </div>
              )}

              <button
                onClick={handleRegister}
                disabled={loading || agentName.trim().length < 2}
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 11,
                  letterSpacing: 2,
                  textTransform: 'uppercase',
                  padding: '14px 24px',
                  background: agentName.trim().length >= 2 ? 'var(--text)' : 'var(--border-strong)',
                  color: agentName.trim().length >= 2 ? 'var(--bg)' : 'var(--text-faint)',
                  border: 'none',
                  cursor: agentName.trim().length >= 2 ? 'pointer' : 'not-allowed',
                  width: '100%',
                  transition: 'all 0.2s',
                }}
              >
                {loading ? 'Creating...' : 'Create Agent'}
              </button>
            </div>
          </div>
        )}

        {/* Step 2: API Key Ready */}
        {step === 'ready' && result && (
          <div className="fade-in">
            <h2 style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: -0.5,
              marginBottom: 8,
              textAlign: 'center',
            }}>
              Agent created
            </h2>
            <p style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              textAlign: 'center',
              marginBottom: 32,
              lineHeight: 1.7,
            }}>
              Save your API key — it won't be shown again.
            </p>

            <div style={{
              border: '1px solid var(--border-strong)',
              marginBottom: 24,
            }}>
              <div style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <span style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 600 }}>
                  API Key
                </span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    onClick={() => setShowKey(!showKey)}
                    style={{
                      fontFamily: 'var(--mono)',
                      fontSize: 10,
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-faint)',
                      cursor: 'pointer',
                      padding: '2px 6px',
                    }}
                  >
                    {showKey ? 'Hide' : 'Show'}
                  </button>
                  <CopyButton text={result.apiKey} />
                </div>
              </div>
              <div style={{
                padding: '14px 16px',
                fontFamily: 'var(--mono)',
                fontSize: 12,
                wordBreak: 'break-all',
                background: 'var(--bg-warm)',
                letterSpacing: 0.5,
              }}>
                {showKey ? result.apiKey : `${'*'.repeat(20)}${result.apiKey.slice(-6)}`}
              </div>
            </div>

            {/* Agent Info */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
              marginBottom: 32,
            }}>
              <div style={{
                padding: '12px 14px',
                border: '1px solid var(--border)',
              }}>
                <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4 }}>
                  Agent Name
                </div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{agentName}</div>
              </div>
              <div style={{
                padding: '12px 14px',
                border: '1px solid var(--border)',
              }}>
                <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4 }}>
                  Agent ID
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--mono)' }}>
                  {result.agentId.slice(0, 12)}...
                </div>
              </div>
            </div>

            <button
              onClick={() => setStep('install')}
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 11,
                letterSpacing: 2,
                textTransform: 'uppercase',
                padding: '14px 24px',
                background: 'var(--text)',
                color: 'var(--bg)',
                border: 'none',
                cursor: 'pointer',
                width: '100%',
                transition: 'all 0.2s',
              }}
            >
              Set Up IDE Integration
            </button>

            <button
              onClick={handleBack}
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 10,
                letterSpacing: 1,
                textTransform: 'uppercase',
                padding: '10px 24px',
                background: 'transparent',
                color: 'var(--text-muted)',
                border: 'none',
                cursor: 'pointer',
                width: '100%',
                marginTop: 8,
              }}
            >
              Skip — Go to Dashboard
            </button>
          </div>
        )}

        {/* Step 3: IDE Installation */}
        {step === 'install' && result && (
          <div className="fade-in">
            <h2 style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: -0.5,
              marginBottom: 8,
              textAlign: 'center',
            }}>
              Connect your IDE
            </h2>
            <p style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              textAlign: 'center',
              marginBottom: 28,
              lineHeight: 1.7,
            }}>
              Copy this config into your IDE's MCP configuration file.<br />
              Your agent will have 4 memory tools: recall, store, stats, clinamen.
            </p>

            {/* IDE Selector */}
            <div style={{
              display: 'flex',
              gap: 8,
              marginBottom: 20,
              justifyContent: 'center',
            }}>
              {ides.map((ide) => (
                <button
                  key={ide.id}
                  onClick={() => setSelectedIde(ide.id)}
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 10,
                    letterSpacing: 1,
                    padding: '10px 16px',
                    background: selectedIde === ide.id ? 'var(--text)' : 'transparent',
                    color: selectedIde === ide.id ? 'var(--bg)' : 'var(--text-muted)',
                    border: `1px solid ${selectedIde === ide.id ? 'var(--text)' : 'var(--border-strong)'}`,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{ide.label}</div>
                  <div style={{ fontSize: 9, opacity: 0.7 }}>{ide.desc}</div>
                </button>
              ))}
            </div>

            {/* Config Path */}
            <div style={{
              fontSize: 10,
              color: 'var(--text-faint)',
              textAlign: 'center',
              marginBottom: 12,
              letterSpacing: 0.5,
            }}>
              Paste into: <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{getConfigPath(selectedIde)}</span>
            </div>

            {/* Config Block */}
            <div style={{
              border: '1px solid var(--border-strong)',
              marginBottom: 16,
            }}>
              <div style={{
                padding: '10px 16px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <span style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 600 }}>
                  MCP Config
                </span>
                <CopyButton text={getMcpConfig(result.apiKey)} label="Copy Config" />
              </div>
              <pre style={{
                padding: '16px',
                fontFamily: 'var(--mono)',
                fontSize: 11,
                lineHeight: 1.6,
                background: 'var(--bg-warm)',
                overflow: 'auto',
                maxHeight: 280,
                whiteSpace: 'pre',
                margin: 0,
              }}>
                {getMcpConfig(result.apiKey)}
              </pre>
            </div>

            {/* Quick terminal install option */}
            <div style={{
              border: '1px solid var(--border)',
              padding: '14px 16px',
              marginBottom: 28,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <div>
                <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4 }}>
                  Or auto-install via terminal
                </div>
                <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  npx clude-bot setup
                </code>
              </div>
              <CopyButton text="npx clude-bot setup" />
            </div>

            {/* Done */}
            <button
              onClick={handleBack}
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 11,
                letterSpacing: 2,
                textTransform: 'uppercase',
                padding: '14px 24px',
                background: 'var(--text)',
                color: 'var(--bg)',
                border: 'none',
                cursor: 'pointer',
                width: '100%',
                transition: 'all 0.2s',
              }}
            >
              Go to Dashboard
            </button>

            <div style={{
              fontSize: 10,
              color: 'var(--text-faint)',
              textAlign: 'center',
              marginTop: 12,
              lineHeight: 1.7,
            }}>
              Restart your IDE after adding the config.
            </div>
          </div>
        )}

        {/* Back button (step 1 only) */}
        {step === 'name' && (
          <div style={{ textAlign: 'center', marginTop: 32 }}>
            <button
              onClick={handleBack}
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 10,
                letterSpacing: 1,
                textTransform: 'uppercase',
                background: 'none',
                border: 'none',
                color: 'var(--text-faint)',
                cursor: 'pointer',
              }}
            >
              Back to Sign In
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
