/**
 * "$ANSEM LIVE" — a live, ranked, filtered feed of the best recent X posts about
 * the $ANSEM token. Docks top-LEFT as a collapsible rail (the "Speak to Ansem"
 * orb lives bottom-right, so the two never collide, and neither obscures the
 * constellation center). Fetches /api/ansem/feed on mount + every ~90s; new
 * posts animate in. If the server reports { enabled:false } (no X_SEARCH_BEARER)
 * the whole panel renders a tiny "coming soon" chip instead of nothing, so the
 * layout stays intentional.
 *
 * Green-on-black, ui-monospace — matches the constellation + chat registers.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { ansemApi } from '../lib/ansem-api';
import type { AnsemFeedPost } from '../lib/ansem-api';

const POLL_MS = 90_000;

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function compactNum(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}m`;
}

export function AnsemFeed() {
  const [posts, setPosts] = useState<AnsemFeedPost[]>([]);
  // enabled: null = unknown (loading), true = live, false = server has no bearer
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [open, setOpen] = useState(true);
  // ids we've already shown — anything new gets the enter animation once
  const seenRef = useRef<Set<string>>(new Set());
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await ansemApi.getFeed(signal);
      if (signal?.aborted) return;
      if (!data.enabled) {
        setEnabled(false);
        setPosts([]);
        return;
      }
      setEnabled(true);
      const incomingFresh = new Set<string>();
      for (const p of data.posts) {
        if (!seenRef.current.has(p.id)) incomingFresh.add(p.id);
      }
      // seed the seen-set on the very first load so we don't animate the whole
      // list in on mount (only genuinely-new posts should fly in afterward)
      const firstLoad = seenRef.current.size === 0;
      for (const p of data.posts) seenRef.current.add(p.id);
      setPosts(data.posts);
      if (!firstLoad && incomingFresh.size > 0) {
        setFreshIds(incomingFresh);
        window.setTimeout(() => setFreshIds(new Set()), 1400);
      }
    } catch {
      // network hiccup — keep whatever we have; if we never loaded, hide the panel
      if (enabled === null) setEnabled(false);
    }
  }, [enabled]);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    const iv = window.setInterval(() => load(), POLL_MS);
    return () => {
      ctrl.abort();
      window.clearInterval(iv);
    };
  }, [load]);

  // Server has no bearer → tiny placeholder chip (keeps the corner intentional).
  if (enabled === false) {
    return (
      <div
        style={{
          position: 'fixed', left: 'clamp(12px,3vw,26px)', top: 'clamp(150px,24vh,190px)', zIndex: 30,
          padding: '7px 12px', borderRadius: 999,
          background: 'rgba(2,12,7,.7)', border: '1px solid rgba(72,224,122,.18)',
          fontFamily: "ui-monospace,'SF Mono',Menlo,monospace",
          fontSize: 9.5, letterSpacing: '.14em', textTransform: 'uppercase', color: 'rgba(147,232,178,.5)',
          pointerEvents: 'none',
        }}
      >
        live feed coming soon
      </div>
    );
  }

  // Still loading and nothing to show yet → render nothing (avoid a flash).
  if (enabled === null && posts.length === 0) return null;

  return (
    <>
      <style>{`
        @keyframes ansemLivePulse { 0%,100% { opacity:1; box-shadow:0 0 0 0 rgba(92,240,138,.5); } 50% { opacity:.65; box-shadow:0 0 0 6px rgba(92,240,138,0); } }
        @keyframes ansemFeedIn { from { opacity:0; transform:translateX(-14px); } to { opacity:1; transform:translateX(0); } }
        @keyframes ansemFeedFlash { 0% { background:rgba(60,224,120,.16); } 100% { background:rgba(255,255,255,.03); } }
        #ansem-feed-list::-webkit-scrollbar{ width:5px; }
        #ansem-feed-list::-webkit-scrollbar-thumb{ background:rgba(72,224,122,.22); border-radius:3px; }
        .ansem-feed-card{ transition:border-color .18s ease, background .18s ease; }
        .ansem-feed-card:hover{ border-color:rgba(72,224,122,.4); background:rgba(60,224,120,.06); }
      `}</style>

      <div
        style={{
          position: 'fixed', left: 'clamp(12px,3vw,26px)', top: 'clamp(150px,24vh,190px)', zIndex: 30,
          width: open ? 'min(320px, calc(100vw - 24px))' : 'auto',
          maxHeight: 'min(56vh, 520px)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          borderRadius: 14,
          border: `1px solid rgba(72,224,122,${open ? '.3' : '.4'})`,
          background: 'rgba(2,12,7,.82)', backdropFilter: 'blur(11px)',
          boxShadow: '0 14px 50px rgba(0,0,0,.6), 0 0 22px rgba(34,197,94,.08)',
          fontFamily: "ui-monospace,'SF Mono',Menlo,monospace",
        }}
      >
        {/* header — always visible; click to collapse/expand */}
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Collapse live feed' : 'Expand live feed'}
          style={{
            flexShrink: 0, display: 'flex', alignItems: 'center', gap: 9,
            padding: open ? '11px 13px 10px' : '10px 14px',
            background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
            borderBottom: open ? '1px solid rgba(72,224,122,.16)' : 'none',
            fontFamily: 'inherit',
          }}
        >
          <span
            style={{
              width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
              background: '#5cf08a', animation: 'ansemLivePulse 2s ease-in-out infinite',
            }}
          />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.1em', color: '#eafff0' }}>
              $ANSEM LIVE
            </span>
            {open && (
              <span style={{ display: 'block', fontSize: 8.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(147,232,178,.5)', marginTop: 3 }}>
                top posts by engagement
              </span>
            )}
          </span>
          <span style={{ fontSize: 11, color: 'rgba(147,232,178,.55)', flexShrink: 0 }}>
            {open ? '–' : '+'}
          </span>
        </button>

        {/* the ranked feed */}
        {open && (
          <div
            id="ansem-feed-list"
            style={{
              flex: 1, minHeight: 0, overflowY: 'auto',
              display: 'flex', flexDirection: 'column', gap: 6,
              padding: '8px 8px 10px',
            }}
          >
            {posts.length === 0 && (
              <div style={{ padding: '14px 10px', textAlign: 'center', fontSize: 10.5, lineHeight: 1.6, color: 'rgba(147,232,178,.45)' }}>
                watching the timeline…
              </div>
            )}
            {posts.map((p) => {
              const isFresh = freshIds.has(p.id);
              return (
                <a
                  key={p.id}
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ansem-feed-card"
                  style={{
                    display: 'block', textDecoration: 'none',
                    padding: '8px 9px', borderRadius: 9,
                    background: 'rgba(255,255,255,.03)',
                    border: '1px solid rgba(255,255,255,.07)',
                    animation: isFresh ? 'ansemFeedIn .5s cubic-bezier(.2,.8,.2,1), ansemFeedFlash 1.4s ease-out' : undefined,
                  }}
                >
                  {/* author row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                    {p.avatar ? (
                      <img
                        src={p.avatar}
                        alt=""
                        width={18}
                        height={18}
                        loading="lazy"
                        style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }}
                      />
                    ) : (
                      <span style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, background: 'rgba(72,224,122,.2)' }} />
                    )}
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#eafff0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 }}>
                      {p.name}
                    </span>
                    <span style={{ fontSize: 10, color: 'rgba(147,232,178,.5)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>
                      @{p.handle}
                    </span>
                    <span style={{ fontSize: 9.5, color: 'rgba(147,232,178,.4)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                      {relativeTime(p.created_at)}
                    </span>
                  </div>

                  {/* tweet text — clamped to 3 lines */}
                  <div
                    style={{
                      fontSize: 11.5, lineHeight: 1.5, color: '#dff5e6',
                      display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                      overflow: 'hidden', wordBreak: 'break-word',
                    }}
                  >
                    {p.text}
                  </div>

                  {/* engagement row */}
                  <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 10, color: 'rgba(147,232,178,.55)', fontVariantNumeric: 'tabular-nums' }}>
                    <span>&#9829; {compactNum(p.likes)}</span>
                    <span>&#8635; {compactNum(p.retweets)}</span>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
