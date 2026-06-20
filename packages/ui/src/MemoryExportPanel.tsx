import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type {
  ContentCategory,
  ExportRequest,
  ExportResult,
  ExportScope,
  ExportSelection,
  MemoryExportPanelProps,
  MemoryType,
  SelectionPreview,
} from './types';
import { MEMORY_TYPES } from './types';

type Theme = 'light' | 'dark';

interface Palette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentBg: string;
  success: string;
  successBg: string;
  danger: string;
  dangerBg: string;
}

const PALETTES: Record<Theme, Palette> = {
  dark: {
    bg: '#0e0e14',
    surface: '#16161f',
    surfaceAlt: '#1d1d28',
    border: 'rgba(255,255,255,0.10)',
    borderStrong: 'rgba(255,255,255,0.18)',
    text: '#e9e9f0',
    textMuted: '#9a9aa8',
    textFaint: '#6b6b78',
    accent: '#6a82ff',
    accentBg: 'rgba(106,130,255,0.16)',
    success: '#27c08a',
    successBg: 'rgba(39,192,138,0.15)',
    danger: '#f06464',
    dangerBg: 'rgba(240,100,100,0.14)',
  },
  light: {
    bg: '#ffffff',
    surface: '#f7f7f4',
    surfaceAlt: '#eeeee8',
    border: 'rgba(0,0,0,0.08)',
    borderStrong: 'rgba(0,0,0,0.14)',
    text: '#16161a',
    textMuted: '#666672',
    textFaint: '#9a9aa2',
    accent: '#2244ff',
    accentBg: 'rgba(34,68,255,0.08)',
    success: '#0c9d6e',
    successBg: 'rgba(12,157,110,0.10)',
    danger: '#d83a3a',
    dangerBg: 'rgba(216,58,58,0.08)',
  },
};

const TYPE_COLOR: Record<MemoryType, string> = {
  episodic: '#5570ff',
  semantic: '#1fbf86',
  procedural: '#f59e0b',
  self_model: '#8b5cf6',
  introspective: '#ec4899',
};

const TYPE_LABEL: Record<MemoryType, string> = {
  episodic: 'episodic',
  semantic: 'semantic',
  procedural: 'procedural',
  self_model: 'self-model',
  introspective: 'introspective',
};

const CATEGORIES: { id: ContentCategory; label: string; note: string }[] = [
  { id: 'personal', label: 'Personal', note: 'Stays private — download & desktop only, never listed for sale.' },
  { id: 'knowledge', label: 'Knowledge', note: 'Eligible to list on the marketplace as a copy or 1-of-1 title.' },
  { id: 'agent', label: 'Agent', note: 'An agent’s memory — portable between your own agents.' },
];

const SCOPES: { id: ExportScope; label: string }[] = [
  { id: 'all', label: 'All memories' },
  { id: 'type', label: 'By type' },
  { id: 'tag', label: 'By tag' },
  { id: 'range', label: 'Date range' },
  { id: 'pack', label: 'Saved pack' },
];

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function fmtBytes(n: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function shortRoot(root: string): string {
  const hex = root.replace(/^sha256:/, '');
  return hex.length > 12 ? `${hex.slice(0, 6)}…${hex.slice(-4)}` : hex;
}

function isoDaysAgo(days: number): string {
  const ms = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

function resolveTheme(theme: 'light' | 'dark' | 'auto' | undefined): Theme {
  if (theme === 'light' || theme === 'dark') return theme;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

/**
 * Self-contained "export memories → .pmp pack" panel. Drives the live
 * /v1/pmp/export flow through the injected `api`. Visual identity is consistent
 * across apps (a branded export surface), themeable light/dark.
 */
export function MemoryExportPanel(props: MemoryExportPanelProps) {
  const {
    api,
    walletAddress,
    theme: themeProp,
    className,
    suggestedTags = [],
    savedPacks = [],
    onExported,
    onDownload,
    onSendToDesktop,
    onListOnMarketplace,
  } = props;

  const theme = resolveTheme(themeProp);
  const p = PALETTES[theme];

  const [scope, setScope] = useState<ExportScope>('all');
  const [types, setTypes] = useState<MemoryType[]>([...MEMORY_TYPES]);
  const [tagInput, setTagInput] = useState('');
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [packId, setPackId] = useState(savedPacks[0]?.pack_id ?? '');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ContentCategory>('personal');
  const [encrypt, setEncrypt] = useState(true);

  const [preview, setPreview] = useState<SelectionPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tags = useMemo(
    () => tagInput.split(',').map((t) => t.trim()).filter(Boolean),
    [tagInput],
  );

  const selection: ExportSelection = useMemo(() => {
    switch (scope) {
      case 'type':
        return { scope, types };
      case 'tag':
        return { scope, tags };
      case 'range':
        return { scope, from, to };
      case 'pack':
        return { scope, pack_id: packId };
      default:
        return { scope: 'all' };
    }
  }, [scope, types, tags, from, to, packId]);

  const selectionKey = JSON.stringify(selection);

  // Debounced preview whenever the selection changes. A new export invalidates
  // the prior result so the artifact card always reflects the current selection.
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(null);
    if (scope === 'pack' && !packId) {
      setPreview(null);
      return;
    }
    setPreviewing(true);
    const handle = setTimeout(() => {
      api
        .preview(selection)
        .then((r) => {
          if (!cancelled) setPreview(r);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : 'Preview failed');
        })
        .finally(() => {
          if (!cancelled) setPreviewing(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // selectionKey captures the meaningful selection identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  const total = preview?.total ?? 0;
  const canExport = total > 0 && name.trim().length > 0 && !exporting && !previewing;

  const handleExport = useCallback(async () => {
    setExporting(true);
    setError(null);
    try {
      const req: ExportRequest = {
        selection,
        name: name.trim(),
        description: description.trim() || undefined,
        category,
        encrypt,
      };
      const r = await api.export(req);
      setResult(r);
      onExported?.(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }, [api, selection, name, description, category, encrypt, onExported]);

  const handleDownload = useCallback(() => {
    if (!result) return;
    if (onDownload) onDownload(result.artifact, result.download);
    else if (typeof window !== 'undefined') window.open(result.download, '_blank');
  }, [result, onDownload]);

  const orderedBreakdown = useMemo(() => {
    if (!preview) return [];
    return MEMORY_TYPES.map((t) => ({ t, n: preview.by_type[t] ?? 0 })).filter((x) => x.n > 0);
  }, [preview]);

  const sumShown = orderedBreakdown.reduce((a, b) => a + b.n, 0) || 1;
  const listable = category !== 'personal';

  return (
    <div
      className={className}
      style={{
        background: p.surface,
        color: p.text,
        borderRadius: 14,
        padding: '1.25rem',
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Inter, sans-serif",
        fontSize: 14,
        lineHeight: 1.5,
        boxSizing: 'border-box',
      }}
    >
      <PanelHeader p={p} />

      <SectionLabel p={p}>1 · What to include</SectionLabel>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {SCOPES.map((s) => (
          <Pill key={s.id} active={scope === s.id} p={p} onClick={() => setScope(s.id)}>
            {s.label}
          </Pill>
        ))}
      </div>

      {scope === 'type' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {MEMORY_TYPES.map((t) => {
            const on = types.includes(t);
            return (
              <Pill
                key={t}
                active={on}
                p={p}
                onClick={() =>
                  setTypes((prev) => (on ? prev.filter((x) => x !== t) : [...prev, t]))
                }
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: TYPE_COLOR[t],
                    display: 'inline-block',
                    marginRight: 6,
                    verticalAlign: 'middle',
                  }}
                />
                {TYPE_LABEL[t]}
              </Pill>
            );
          })}
        </div>
      )}

      {scope === 'tag' && (
        <div style={{ marginBottom: 12 }}>
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder="tag, comma-separated (e.g. $CLUDE, compliance)"
            style={inputStyle(p)}
          />
          {suggestedTags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {suggestedTags.map((t) => (
                <Pill
                  key={t}
                  active={tags.includes(t)}
                  p={p}
                  onClick={() =>
                    setTagInput((prev) => {
                      const cur = prev.split(',').map((x) => x.trim()).filter(Boolean);
                      return cur.includes(t)
                        ? cur.filter((x) => x !== t).join(', ')
                        : [...cur, t].join(', ');
                    })
                  }
                >
                  {t}
                </Pill>
              ))}
            </div>
          )}
        </div>
      )}

      {scope === 'range' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={inputStyle(p)} />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={inputStyle(p)} />
        </div>
      )}

      {scope === 'pack' && (
        <div style={{ marginBottom: 12 }}>
          {savedPacks.length > 0 ? (
            <select value={packId} onChange={(e) => setPackId(e.target.value)} style={inputStyle(p)}>
              {savedPacks.map((sp) => (
                <option key={sp.pack_id} value={sp.pack_id}>
                  {sp.name}
                  {sp.count != null ? ` (${fmtNum(sp.count)})` : ''}
                </option>
              ))}
            </select>
          ) : (
            <div style={{ color: p.textFaint, fontSize: 13 }}>No saved packs yet.</div>
          )}
        </div>
      )}

      <div
        style={{
          background: p.bg,
          border: `1px solid ${p.border}`,
          borderRadius: 8,
          padding: '12px 14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minHeight: 30 }}>
          <span style={{ fontSize: 24, fontWeight: 500 }}>
            {previewing ? '…' : fmtNum(total)}
          </span>
          <span style={{ fontSize: 13, color: p.textMuted }}>memories selected</span>
        </div>
        {orderedBreakdown.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: 3, marginTop: 10, height: 8, borderRadius: 4, overflow: 'hidden' }}>
              {orderedBreakdown.map((x) => (
                <div key={x.t} style={{ flex: x.n / sumShown, background: TYPE_COLOR[x.t] }} />
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8, fontSize: 11.5, color: p.textMuted }}>
              {orderedBreakdown.map((x) => (
                <span key={x.t} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: TYPE_COLOR[x.t] }} />
                  {TYPE_LABEL[x.t]} {fmtNum(x.n)}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <SectionLabel p={p}>2 · Pack details</SectionLabel>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Pack name (e.g. My working memory, Jun 2026)"
        style={{ ...inputStyle(p), marginBottom: 10 }}
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        style={{ ...inputStyle(p), marginBottom: 10 }}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {CATEGORIES.map((c) => {
          const on = category === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 3,
                padding: '10px 11px',
                textAlign: 'left',
                cursor: 'pointer',
                background: on ? p.accentBg : p.bg,
                color: p.text,
                border: `${on ? 2 : 1}px solid ${on ? p.accent : p.border}`,
                borderRadius: 8,
                font: 'inherit',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 500 }}>{c.label}</span>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 12, color: p.textMuted, marginTop: 8 }}>
        {CATEGORIES.find((c) => c.id === category)?.note}
      </div>

      <SectionLabel p={p}>3 · Safety & privacy</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <ScanStatus p={p} flagged={preview?.flagged ?? 0} />
        <button
          type="button"
          onClick={() => setEncrypt((v) => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: p.bg,
            border: `1px solid ${p.border}`,
            borderRadius: 8,
            padding: '10px 12px',
            font: 'inherit',
            fontSize: 13,
            color: p.text,
            cursor: 'pointer',
          }}
        >
          <span>Encrypt with your owner-held key</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: encrypt ? p.accent : p.textFaint }}>
            {encrypt ? 'On' : 'Off'}
          </span>
        </button>
      </div>

      {error && (
        <div
          style={{
            marginTop: 14,
            background: p.dangerBg,
            color: p.danger,
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <button
        type="button"
        disabled={!canExport}
        onClick={handleExport}
        style={{
          marginTop: 16,
          width: '100%',
          padding: '11px 16px',
          background: canExport ? p.accent : p.surfaceAlt,
          color: canExport ? '#fff' : p.textFaint,
          border: 'none',
          borderRadius: 8,
          fontFamily: 'inherit',
          fontSize: 14,
          fontWeight: 500,
          cursor: canExport ? 'pointer' : 'not-allowed',
        }}
      >
        {exporting ? 'Building pack…' : 'Export memory pack'}
      </button>

      {result && (
        <ResultCard
          p={p}
          result={result}
          listable={listable}
          onDownload={handleDownload}
          onSendToDesktop={onSendToDesktop}
          onListOnMarketplace={onListOnMarketplace}
        />
      )}

      {walletAddress && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: p.textFaint, textAlign: 'right' }}>
          creator: {walletAddress.slice(0, 4)}…{walletAddress.slice(-4)}
        </div>
      )}
    </div>
  );
}

function PanelHeader({ p }: { p: Palette }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 8,
          background: p.accentBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: p.accent,
          fontSize: 20,
        }}
        aria-hidden="true"
      >
        ⤓
      </div>
      <div>
        <div style={{ fontSize: 16, fontWeight: 500 }}>Export memories</div>
        <div style={{ fontSize: 13, color: p.textMuted }}>
          Package your brain into a portable, verifiable <code>.pmp</code> pack
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ p, children }: { p: Palette; children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 12,
        color: p.textFaint,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        margin: '1.25rem 0 8px',
      }}
    >
      {children}
    </div>
  );
}

function Pill({
  active,
  p,
  onClick,
  children,
}: {
  active: boolean;
  p: Palette;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 12.5,
        padding: '5px 11px',
        borderRadius: 7,
        cursor: 'pointer',
        background: active ? p.accentBg : p.bg,
        color: active ? p.accent : p.text,
        border: `${active ? 2 : 1}px solid ${active ? p.accent : p.border}`,
        fontWeight: active ? 500 : 400,
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

function ScanStatus({ p, flagged }: { p: Palette; flagged: number }) {
  const clean = flagged === 0;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: clean ? p.successBg : p.dangerBg,
        color: clean ? p.success : p.danger,
        borderRadius: 8,
        padding: '10px 12px',
        fontSize: 13,
      }}
    >
      <span aria-hidden="true">{clean ? '✓' : '!'}</span>
      <span>
        {clean
          ? 'Content scan passed — no passwords, API keys, or PII found'
          : `${fmtNum(flagged)} item${flagged === 1 ? '' : 's'} held back — secrets or PII detected`}
      </span>
    </div>
  );
}

function ResultCard({
  p,
  result,
  listable,
  onDownload,
  onSendToDesktop,
  onListOnMarketplace,
}: {
  p: Palette;
  result: ExportResult;
  listable: boolean;
  onDownload: () => void;
  onSendToDesktop?: (a: ExportResult['artifact']) => void;
  onListOnMarketplace?: (a: ExportResult['artifact']) => void;
}) {
  const a = result.artifact;
  const btn = (primary: boolean): CSSProperties=> ({
    flex: 1,
    minWidth: 140,
    padding: '9px 12px',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 500,
    background: primary ? p.accent : p.bg,
    color: primary ? '#fff' : p.text,
    border: primary ? 'none' : `1px solid ${p.borderStrong}`,
  });
  return (
    <div
      style={{
        marginTop: 16,
        background: p.bg,
        border: `1px solid ${p.borderStrong}`,
        borderRadius: 12,
        padding: '1rem 1.1rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontWeight: 500, fontSize: 14 }}>{a.title || 'memory-pack'}.pmp</span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            background: p.successBg,
            color: p.success,
            fontSize: 11.5,
            fontWeight: 500,
            padding: '3px 9px',
            borderRadius: 8,
          }}
        >
          ✓ self-verifiable{result.deduped ? ' · already exported' : ''}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
        <Stat p={p} label="records" value={fmtNum(a.record_count)} />
        <Stat p={p} label="size" value={fmtBytes(a.byte_size)} />
        <Stat p={p} label="merkle root" value={shortRoot(a.merkle_root)} mono />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" style={btn(true)} onClick={onDownload}>
          Download .pmp
        </button>
        {onSendToDesktop && (
          <button type="button" style={btn(false)} onClick={() => onSendToDesktop(a)}>
            Send to Clude desktop
          </button>
        )}
        {onListOnMarketplace &&
          (listable ? (
            <button type="button" style={btn(false)} onClick={() => onListOnMarketplace(a)}>
              List on marketplace
            </button>
          ) : (
            <span
              style={{
                flex: 1,
                minWidth: 140,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: p.textFaint,
                padding: '0 6px',
              }}
            >
              personal packs stay private
            </span>
          ))}
      </div>
    </div>
  );
}

function Stat({ p, label, value, mono }: { p: Palette; label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ background: p.surface, borderRadius: 8, padding: '9px 11px' }}>
      <div style={{ fontSize: 11, color: p.textMuted }}>{label}</div>
      <div
        style={{
          fontSize: mono ? 13 : 17,
          fontWeight: 500,
          marginTop: mono ? 3 : 0,
          fontFamily: mono ? "ui-monospace, 'JetBrains Mono', monospace" : 'inherit',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function inputStyle(p: Palette): CSSProperties{
  return {
    width: '100%',
    boxSizing: 'border-box',
    padding: '9px 11px',
    background: p.bg,
    color: p.text,
    border: `1px solid ${p.border}`,
    borderRadius: 8,
    fontFamily: 'inherit',
    fontSize: 13,
  };
}
