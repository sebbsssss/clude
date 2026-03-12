import { useState } from 'react';
import { useAuthContext } from '../hooks/AuthContext';

export function Landing() {
  const { login, loginWithApiKey } = useAuthContext();
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);

  async function handleApiKeyLogin() {
    if (!apiKey.trim()) return;
    setError('');
    setConnecting(true);
    const valid = await loginWithApiKey(apiKey.trim(), endpoint.trim() || undefined);
    if (!valid) {
      setError('Invalid API key or endpoint unreachable');
    }
    setConnecting(false);
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px',
    }}>
      <div style={{ maxWidth: 480, textAlign: 'center' }}>
        <div style={{
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: 5,
          textTransform: 'uppercase' as const,
          marginBottom: 32,
        }}>
          CLUDE
        </div>

        <h1 style={{
          fontSize: 'clamp(28px, 4vw, 40px)',
          fontWeight: 800,
          lineHeight: 1.1,
          letterSpacing: -1,
          marginBottom: 20,
        }}>
          See what your<br />
          agent <span style={{
            background: 'linear-gradient(135deg, #2244ff, #5566ff)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>remembers.</span>
        </h1>

        <p style={{
          fontSize: 14,
          color: 'var(--text-muted)',
          lineHeight: 1.8,
          marginBottom: 40,
          maxWidth: 380,
          margin: '0 auto 40px',
        }}>
          Sign in to explore your agent's memory.
          Visualize, search, export, and share knowledge
          across agents.
        </p>

        <button
          onClick={login}
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 11,
            letterSpacing: 2,
            textTransform: 'uppercase' as const,
            padding: '14px 32px',
            background: 'var(--text)',
            color: 'var(--bg)',
            border: '2px solid var(--text)',
            cursor: 'pointer',
            transition: 'all 0.25s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--text)';
            e.currentTarget.style.color = 'var(--bg)';
          }}
        >
          Sign In with Wallet
        </button>

        {/* Divider */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          margin: '32px 0',
          maxWidth: 320,
          marginLeft: 'auto',
          marginRight: 'auto',
        }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border-strong)' }} />
          <span style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-faint)' }}>or</span>
          <div style={{ flex: 1, height: 1, background: 'var(--border-strong)' }} />
        </div>

        {/* API Key Login */}
        <div style={{ maxWidth: 320, margin: '0 auto', textAlign: 'left' }}>
          <label style={{ display: 'block', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 6 }}>
            Cortex API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="clk_..."
            onKeyDown={(e) => e.key === 'Enter' && handleApiKeyLogin()}
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 12,
              padding: '10px 12px',
              border: '1px solid var(--border-strong)',
              background: 'transparent',
              width: '100%',
              outline: 'none',
              marginBottom: 12,
            }}
          />

          <label style={{ display: 'block', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 6 }}>
            Endpoint
          </label>
          <input
            type="text"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="https://clude.io (default)"
            onKeyDown={(e) => e.key === 'Enter' && handleApiKeyLogin()}
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 12,
              padding: '10px 12px',
              border: '1px solid var(--border-strong)',
              background: 'transparent',
              width: '100%',
              outline: 'none',
              marginBottom: 16,
            }}
          />

          {error && (
            <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 12 }}>
              {error}
            </div>
          )}

          <button
            onClick={handleApiKeyLogin}
            disabled={!apiKey.trim() || connecting}
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 10,
              letterSpacing: 2,
              textTransform: 'uppercase',
              padding: '12px 24px',
              background: apiKey.trim() ? 'var(--text)' : 'var(--border-strong)',
              color: apiKey.trim() ? 'var(--bg)' : 'var(--text-faint)',
              border: 'none',
              cursor: apiKey.trim() ? 'pointer' : 'not-allowed',
              width: '100%',
            }}
          >
            {connecting ? 'Connecting...' : 'Connect with API Key'}
          </button>

          <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 8, textAlign: 'center' }}>
            Get a key with <span style={{ fontFamily: 'var(--mono)' }}>npx clude-bot register</span>
          </div>
        </div>

        <div style={{
          marginTop: 48,
          display: 'flex',
          justifyContent: 'center',
          gap: 32,
          fontSize: 10,
          letterSpacing: 2,
          textTransform: 'uppercase' as const,
          color: 'var(--text-faint)',
        }}>
          <span>Memory Timeline</span>
          <span>Entity Graph</span>
          <span>Brain View</span>
          <span>Memory Packs</span>
        </div>
      </div>
    </div>
  );
}
