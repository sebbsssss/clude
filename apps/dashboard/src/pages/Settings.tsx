import { useState, useMemo } from 'react';
import { useAuthContext } from '../hooks/AuthContext';
import { api } from '../lib/api';

const CORTEX_HOST = 'https://clude.io';

type IDE = 'claude-desktop' | 'claude-code' | 'cursor';

function getMcpSnippet(apiKey: string): string {
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
    case 'claude-desktop': return '~/Library/Application Support/Claude/claude_desktop_config.json';
    case 'claude-code': return '.mcp.json (project root)';
    case 'cursor': return '~/.cursor/mcp.json';
  }
}

function McpConfigSection() {
  const [selectedIde, setSelectedIde] = useState<IDE>('claude-code');
  const [copied, setCopied] = useState(false);

  const storedKey = localStorage.getItem('cortex_api_key') || '';

  const ides: { id: IDE; label: string }[] = [
    { id: 'claude-code', label: 'Claude Code' },
    { id: 'claude-desktop', label: 'Claude Desktop' },
    { id: 'cursor', label: 'Cursor' },
  ];

  const config = useMemo(() => {
    if (!storedKey) return '';
    return getMcpSnippet(storedKey);
  }, [storedKey]);

  if (!storedKey) return null;

  return (
    <div style={{ border: '1px solid var(--border)', marginBottom: 24 }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 600 }}>
        IDE Integration (MCP)
      </div>
      <div style={{ padding: 20 }}>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.7 }}>
          Copy this config into your IDE to give your agent memory tools.
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {ides.map((ide) => (
            <button
              key={ide.id}
              onClick={() => setSelectedIde(ide.id)}
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 10,
                letterSpacing: 1,
                padding: '8px 14px',
                background: selectedIde === ide.id ? 'var(--text)' : 'transparent',
                color: selectedIde === ide.id ? 'var(--bg)' : 'var(--text-muted)',
                border: `1px solid ${selectedIde === ide.id ? 'var(--text)' : 'var(--border-strong)'}`,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {ide.label}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 8 }}>
          Paste into: <strong style={{ color: 'var(--text-muted)' }}>{getConfigPath(selectedIde)}</strong>
        </div>

        <div style={{ border: '1px solid var(--border)', marginBottom: 12 }}>
          <pre style={{
            padding: 14,
            fontFamily: 'var(--mono)',
            fontSize: 11,
            lineHeight: 1.6,
            background: 'var(--bg-warm)',
            overflow: 'auto',
            maxHeight: 220,
            margin: 0,
            whiteSpace: 'pre',
          }}>
            {config}
          </pre>
        </div>

        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(config);
            } catch {
              const ta = document.createElement('textarea');
              ta.value = config;
              ta.style.position = 'fixed';
              ta.style.opacity = '0';
              document.body.appendChild(ta);
              ta.select();
              document.execCommand('copy');
              document.body.removeChild(ta);
            }
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 10,
            letterSpacing: 2,
            textTransform: 'uppercase',
            padding: '10px 24px',
            background: copied ? '#10b981' : 'var(--text)',
            color: 'var(--bg)',
            border: 'none',
            cursor: 'pointer',
            transition: 'background 0.2s',
          }}
        >
          {copied ? 'Copied!' : 'Copy Config'}
        </button>

        <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 10 }}>
          Restart your IDE after adding the config.
        </div>
      </div>
    </div>
  );
}

export function Settings() {
  const { walletAddress, email, userId, authMode } = useAuthContext();
  const [endpoint, setEndpoint] = useState('https://clude.io');
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);

  function handleSave() {
    if (endpoint) api.setAgentEndpoint(endpoint);
    if (apiKey) api.setToken(apiKey);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div>
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 12 }}>
          Configuration
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, marginBottom: 8 }}>
          Settings
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {authMode === 'cortex' ? 'Cortex API key connection.' : 'Connect your Clude-enabled agent.'}
        </p>
      </div>

      {/* Account Info */}
      <div style={{ border: '1px solid var(--border)', marginBottom: 24 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 600 }}>
          Account
        </div>
        <div style={{ padding: 20 }}>
          {authMode === 'cortex' ? (
            <>
              <div style={{ fontSize: 13, fontFamily: 'var(--mono)', marginBottom: 8 }}>
                Mode: Cortex (Hosted)
              </div>
              <div style={{ fontSize: 13, fontFamily: 'var(--mono)', marginBottom: 8 }}>
                API Key: {'*'.repeat(20)}{localStorage.getItem('cortex_api_key')?.slice(-4) || ''}
              </div>
              <div style={{ fontSize: 13, fontFamily: 'var(--mono)', marginBottom: 8 }}>
                Endpoint: {localStorage.getItem('cortex_endpoint') || 'https://clude.io'}
              </div>
            </>
          ) : (
            <>
              {email && (
                <div style={{ fontSize: 13, fontFamily: 'var(--mono)', marginBottom: 8 }}>
                  {email}
                </div>
              )}
              <div style={{ fontSize: 13, fontFamily: 'var(--mono)', marginBottom: 8 }}>
                {walletAddress || 'No wallet connected'}
              </div>
              {userId && (
                <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                  Privy ID: {userId}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Agent Connection — only for Privy mode */}
      {authMode !== 'cortex' && (
        <div style={{ border: '1px solid var(--border)', marginBottom: 24 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 600 }}>
            Agent Connection
          </div>
          <div style={{ padding: 20 }}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 6 }}>
                Agent API Endpoint
              </label>
              <input
                type="text"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="https://your-agent.up.railway.app"
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 12,
                  padding: '8px 12px',
                  border: '1px solid var(--border-strong)',
                  background: 'transparent',
                  width: '100%',
                  maxWidth: 400,
                  outline: 'none',
                }}
              />
              <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 4 }}>
                The URL where your Clude-enabled agent is running
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 6 }}>
                API Key (optional)
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Your agent's API key"
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 12,
                  padding: '8px 12px',
                  border: '1px solid var(--border-strong)',
                  background: 'transparent',
                  width: '100%',
                  maxWidth: 400,
                  outline: 'none',
                }}
              />
            </div>

            <button
              onClick={handleSave}
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 10,
                letterSpacing: 2,
                textTransform: 'uppercase',
                padding: '10px 24px',
                background: 'var(--text)',
                color: 'var(--bg)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {saved ? 'Saved!' : 'Connect Agent'}
            </button>
          </div>
        </div>
      )}

      {/* MCP IDE Integration — Cortex mode */}
      {authMode === 'cortex' && <McpConfigSection />}

      {/* How it works */}
      <div style={{ border: '1px solid var(--border)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 600 }}>
          {authMode === 'cortex' ? 'About Cortex Mode' : 'How to Connect'}
        </div>
        <div style={{ padding: 20, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.8 }}>
          {authMode === 'cortex' ? (
            <>
              <p style={{ marginBottom: 12 }}>
                You're using hosted Cortex mode. Your memories are stored on CLUDE infrastructure, isolated by your API key.
              </p>
              <p style={{ marginBottom: 12 }}>
                Available features: Memory Timeline, Brain View, Decay Heatmap, Memory Recall.
              </p>
              <p>
                For entity graphs and memory packs, switch to self-hosted mode with your own Supabase.
              </p>
            </>
          ) : (
            <>
              <p style={{ marginBottom: 12 }}>
                1. Deploy your agent with the Clude SDK (npm install @clude/sdk)
              </p>
              <p style={{ marginBottom: 12 }}>
                2. Enter your agent's API endpoint above
              </p>
              <p style={{ marginBottom: 12 }}>
                3. Your Privy account will be linked to your agent for authentication
              </p>
              <p>
                4. Explore your agent's memory, export packs, and share selectively
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
