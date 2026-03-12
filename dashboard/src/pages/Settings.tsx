import { useState } from 'react';
import { useAuthContext } from '../hooks/AuthContext';
import { api } from '../lib/api';

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
