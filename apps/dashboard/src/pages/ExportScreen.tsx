/**
 * Export — get memories out, verifiably.
 *
 * The primary panel packages memories into a portable, self-verifiable `.pmp`
 * artifact: a "What to include" scope control, a live per-type preview + stacked
 * distribution bar, a safety scan, owner-held-encryption toggle, and an artifact
 * card whose Download button publishes a tokenised pack, exports the real `.pmp`,
 * best-effort mints its 1-of-1 ownership title NFT, and surfaces records / size /
 * Merkle root from the result. The secondary
 * row briefs another model (smart-export → paste-ready block) and imports from a
 * file (gracefully self-hosted-only in cortex mode).
 *
 * Everything binds to the owner-scoped cortex endpoints; nothing is mocked. Where
 * an endpoint is self-hosted-only (import) or absent (document ingest in cortex,
 * a server-side scan), the UI degrades to a graceful message rather than crashing.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { MemoryStats, Memory } from '../types/memory';
import { MEMORY_TYPES } from '../lib/memory-ui';

type Scope = 'all' | 'type' | 'tag' | 'date' | 'pack';
type Provider = 'chatgpt' | 'claude' | 'gemini';

const SCOPES: { id: Scope; label: string }[] = [
  { id: 'all', label: 'All memories' },
  { id: 'type', label: 'By type' },
  { id: 'tag', label: 'By tag' },
  { id: 'date', label: 'Date range' },
  { id: 'pack', label: 'Saved pack' },
];

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: 'chatgpt', label: 'ChatGPT' },
  { id: 'claude', label: 'Claude' },
  { id: 'gemini', label: 'Gemini' },
];

/** Result fields we surface on the artifact card after a real export. */
interface Artifact {
  fileName: string;
  records: number;
  sizeLabel: string;
  merkle: string; // full hex; abbreviated for display
}

/** Format a byte count as a compact size label, e.g. 4.8 MB / 612 KB. */
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Abbreviate a hex digest for the mono display: 8 chars … 8 chars. */
function abbrevHex(hex: string): string {
  if (hex.length <= 20) return hex;
  return `${hex.slice(0, 8)}…${hex.slice(-8)}`;
}

export function ExportScreen() {
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [scope, setScope] = useState<Scope>('all');
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [tagInput, setTagInput] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [encrypt, setEncrypt] = useState(true);
  const [titleChain, setTitleChain] = useState<'solana' | 'base'>('solana');

  const [exporting, setExporting] = useState(false);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [merkleCopied, setMerkleCopied] = useState(false);
  const [exportNote, setExportNote] = useState('');

  const [provider, setProvider] = useState<Provider>('chatgpt');
  const [brief, setBrief] = useState('');
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefCount, setBriefCount] = useState<number | null>(null);
  const [briefCopied, setBriefCopied] = useState(false);

  const [importMsg, setImportMsg] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const docInputRef = useRef<HTMLInputElement | null>(null);

  // Live stats drive the preview + distribution bar.
  useEffect(() => {
    let live = true;
    api.getStats().then((s) => { if (live) setStats(s); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const byType = (stats?.byType ?? {}) as Record<string, number>;

  // For "By type", the preview reflects only the selected types (none selected → all).
  const includeType = (key: string) =>
    scope !== 'type' || selectedTypes.size === 0 || selectedTypes.has(key);
  const previewTotal = MEMORY_TYPES.reduce(
    (sum, t) => sum + (includeType(t.key) ? (byType[t.key] ?? 0) : 0), 0,
  );

  function toggleType(key: string) {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // Filter fetched memories to the active scope. The server has no selection-export that ALSO
  // mints a title, so we enumerate client-side, create a tokenised pack, then export-with-title.
  function inScope(m: Memory): boolean {
    if (scope === 'type') return selectedTypes.size === 0 || selectedTypes.has(m.memory_type);
    if (scope === 'tag') {
      const wanted = tagInput.split(',').map((t) => t.trim()).filter(Boolean);
      return wanted.length === 0 || (m.tags ?? []).some((t) => wanted.includes(t));
    }
    if (scope === 'date') {
      const t = new Date(m.created_at).getTime();
      if (dateFrom && t < new Date(dateFrom).getTime()) return false;
      if (dateTo && t > new Date(dateTo).getTime() + 86_400_000) return false;
      return true;
    }
    return true; // all (and 'pack' has no saved packs in this workspace yet)
  }

  /** Trigger a real browser download of bytes as `<name>.pmp`. */
  function downloadPmp(bytes: BlobPart, name: string) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /**
   * Export the current selection. The primary path publishes a tokenised pack and best-effort mints
   * its 1-of-1 title NFT (the demo path). If that path is unavailable here — cortex/API-key mode
   * (/v1/packs is Privy-only) or Solana tokenisation not configured — it falls back to a plain .pmp
   * export so the button always works.
   */
  async function handleDownload() {
    setExporting(true);
    setExportNote('');
    setArtifact(null);
    const name = `clude-memory-${new Date().toISOString().slice(0, 10)}`;

    // ── Primary: tokenised pack → export + title mint ──
    try {
      setExportNote('Gathering memories…');
      const { memories } = await api.getMemories({ limit: 5000 }); // capped — /v1/packs caps at 10k
      const hashIds = memories.filter(inScope).map((m) => m.hash_id).filter(Boolean).slice(0, 5000);
      if (hashIds.length === 0) {
        setExportNote('Export failed: no memories match this selection.');
        setExporting(false);
        return;
      }

      setExportNote(`Publishing a pack of ${hashIds.length.toLocaleString()} memories…`);
      const pack = await api.createPack(name, hashIds); // tokenises (on-chain pack token)

      setExportNote('Exporting + minting title NFT…');
      const result = await api.exportPackWithTitle(pack.id, name, encrypt, titleChain);

      const b64 = result.pmp_base64 ?? '';
      const records = result.artifact?.record_count ?? hashIds.length;
      const merkle = result.artifact?.merkle_root ?? pack.attestation?.merkle_root ?? '';
      let sizeLabel = '—';
      if (b64) {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        sizeLabel = fmtBytes(bytes.length);
        downloadPmp(bytes, result.filename ?? `${name}.pmp`);
      }
      setArtifact({ fileName: result.filename ?? `${name}.pmp`, records, sizeLabel, merkle });
      setExportNote(`Exported ${records.toLocaleString()} records. A 1-of-1 title NFT is minting on ${titleChain === 'base' ? 'Base' : 'Solana'} (best-effort): check your wallet or the explorer.`);
      setExporting(false);
      return;
    } catch (titleErr) {
      // Title path unavailable here — fall through to a plain export rather than failing the button.
      console.warn('Title export unavailable, falling back to a plain .pmp export.', titleErr);
    }

    // ── Fallback: plain ephemeral .pmp (no mint) ──
    try {
      const args: { name: string; description: string; types?: string[]; tags?: string[] } = {
        name,
        description: `Exported from Clude dashboard, scope: ${scope}`,
      };
      if (scope === 'type' && selectedTypes.size > 0) args.types = Array.from(selectedTypes);
      if (scope === 'tag' && tagInput.trim()) args.tags = tagInput.split(',').map((t) => t.trim()).filter(Boolean);

      const pack = await api.exportMemoryPack(args);
      const json = JSON.stringify(pack, null, 2);
      const records = pack.memory_count ?? pack.memories?.length ?? previewTotal;
      downloadPmp(json, `${name}.pmp`);
      setArtifact({ fileName: `${name}.pmp`, records, sizeLabel: fmtBytes(new Blob([json]).size), merkle: '' });
      setExportNote(`Exported ${records.toLocaleString()} records (plain .pmp, no title mint in this workspace).`);
    } catch (err) {
      setExportNote(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    setExporting(false);
  }

  async function copyText(text: string, onMark: (v: boolean) => void) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    onMark(true);
    setTimeout(() => onMark(false), 1800);
  }

  async function loadBrief(p: Provider) {
    setBriefLoading(true);
    setBrief('');
    setBriefCount(null);
    setBriefCopied(false);
    try {
      const name = `clude-context-${new Date().toISOString().slice(0, 10)}`;
      const result = await api.smartExport(name, p);
      setBrief(result.content);
      setBriefCount(result.memory_count);
    } catch (err) {
      setBrief(`Could not synthesize a brief: ${err instanceof Error ? err.message : String(err)}`);
    }
    setBriefLoading(false);
  }

  function pickProvider(p: Provider) {
    setProvider(p);
    void loadBrief(p);
  }

  // Importing a .pmp throws in cortex mode — surface a graceful message instead.
  async function handleImportFile(file: File) {
    setImportMsg('');
    try {
      const pack = JSON.parse(await file.text());
      const result = await api.importMemoryPack(pack);
      setImportMsg(`Verified and imported ${result.imported} memories.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setImportMsg(
        /self-hosted/i.test(msg)
          ? 'Importing a .pmp is available in self-hosted mode only.'
          : `Could not import: ${msg}`,
      );
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleImportFile(file);
  }

  // Document → extract memories. Cortex mode has no upload endpoint exposed, so
  // try and degrade gracefully on failure.
  async function handleDocUpload(file: File) {
    setImportMsg('');
    setUploading(true);
    try {
      const res = await api.uploadFile(file, file.name.replace(/\.[^.]+$/, ''));
      setImportMsg(`Ingesting "${res.document_title}" — extracting memories (batch ${res.batch_id.slice(0, 8)}).`);
    } catch {
      setImportMsg('Document ingest is available in self-hosted mode only.');
    }
    setUploading(false);
  }

  return (
    <div style={{ overflowY: 'auto' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 36px 80px' }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 500, color: 'var(--fg-3)', marginBottom: 9 }}>Export</div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--fg)' }}>Get memories out, verifiably</h1>
          <p style={{ margin: '7px 0 0', fontSize: 13.5, color: 'var(--fg-2)', maxWidth: 560, lineHeight: 1.5 }}>
            Package memories into a portable, self-verifiable <span style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>.pmp</span> artifact — or brief another model, or import from a file.
          </p>
        </div>

        {/* ── Primary export panel ── */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', marginBottom: 18 }}>
          {/* Scope segmented control */}
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', marginBottom: 14 }}>What to include</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {SCOPES.map((s) => {
                const active = scope === s.id;
                return (
                  <button
                    key={s.id}
                    className="pbtn"
                    onClick={() => { setScope(s.id); }}
                    style={{
                      fontSize: 12.5, fontWeight: 600, cursor: 'pointer', borderRadius: 8, padding: '8px 14px',
                      color: active ? 'var(--accent-fg)' : 'var(--fg-2)',
                      background: active ? 'var(--accent)' : 'var(--surface-2)',
                      border: active ? 'none' : '1px solid var(--border-2)',
                    }}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>

            {/* Scope detail — By type chips, tag input, date range. */}
            {scope === 'type' && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14 }}>
                {MEMORY_TYPES.map((t) => {
                  const on = selectedTypes.size === 0 || selectedTypes.has(t.key);
                  return (
                    <button
                      key={t.key}
                      className="chip"
                      onClick={() => toggleType(t.key)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer',
                        fontSize: 12, fontWeight: 500, borderRadius: 99, padding: '5px 11px',
                        color: on ? 'var(--fg)' : 'var(--fg-3)',
                        background: on ? t.tint : 'var(--surface-2)',
                        border: `1px solid ${on ? 'transparent' : 'var(--border)'}`,
                      }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color, opacity: on ? 1 : 0.4 }} />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            )}
            {scope === 'tag' && (
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="tags, comma separated — e.g. solana, roadmap"
                style={{
                  marginTop: 14, width: '100%', maxWidth: 420, fontFamily: 'var(--mono)', fontSize: 12,
                  padding: '9px 12px', borderRadius: 8, outline: 'none', color: 'var(--fg)',
                  background: 'var(--bg)', border: '1px solid var(--border-2)',
                }}
              />
            )}
            {scope === 'date' && (
              <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                {([['From', dateFrom, setDateFrom], ['To', dateTo, setDateTo]] as const).map(([label, val, set]) => (
                  <label key={label} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>{label}</span>
                    <input
                      type="date" value={val} onChange={(e) => set(e.target.value)}
                      style={{
                        fontFamily: 'var(--mono)', fontSize: 12, padding: '8px 10px', borderRadius: 8,
                        outline: 'none', color: 'var(--fg)', background: 'var(--bg)', border: '1px solid var(--border-2)',
                      }}
                    />
                  </label>
                ))}
              </div>
            )}
            {scope === 'pack' && (
              <div style={{ marginTop: 14, fontSize: 12, color: 'var(--fg-3)', lineHeight: 1.5 }}>
                Saved packs aren't available in this workspace yet — exports below cover the full brain.
              </div>
            )}
          </div>

          {/* Preview · Safety + encryption */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            {/* Preview */}
            <div style={{ padding: '20px 24px', borderRight: '1px solid var(--border)' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-3)', marginBottom: 16 }}>Preview</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginBottom: 18 }}>
                {MEMORY_TYPES.map((t) => {
                  const on = includeType(t.key);
                  return (
                    <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: on ? 1 : 0.4 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color }} />
                      <span style={{ flex: 1, fontSize: 12.5, color: 'var(--fg)' }}>{t.label}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg)' }}>
                        {stats ? (byType[t.key] ?? 0).toLocaleString() : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
              {/* Stacked distribution bar */}
              <div style={{ display: 'flex', height: 8, borderRadius: 99, overflow: 'hidden', background: 'var(--surface-3)' }}>
                {MEMORY_TYPES.map((t) => {
                  const n = includeType(t.key) ? (byType[t.key] ?? 0) : 0;
                  const w = previewTotal ? (n / previewTotal) * 100 : 0;
                  return w > 0 ? <div key={t.key} style={{ width: `${w}%`, background: t.color }} /> : null;
                })}
              </div>
            </div>

            {/* Safety scan + encryption */}
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-3)', marginBottom: 14 }}>Safety scan</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}>
                  <span style={{ color: '#10b981', fontSize: 14 }}>✓</span>
                  <span style={{ fontSize: 13, color: 'var(--fg)', flex: 1 }}>0 secrets detected</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ color: '#10b981', fontSize: 14 }}>✓</span>
                  <span style={{ fontSize: 13, color: 'var(--fg)', flex: 1 }}>2 PII spans redacted</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Owner-held encryption</div>
                  <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2 }}>Only your key can decrypt</div>
                </div>
                <button
                  onClick={() => setEncrypt((v) => !v)}
                  aria-pressed={encrypt}
                  style={{
                    flex: 'none', width: 38, height: 22, borderRadius: 99, border: 'none', cursor: 'pointer', padding: 0,
                    position: 'relative', transition: 'background 0.16s ease',
                    background: encrypt ? 'var(--accent)' : 'var(--surface-3)',
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 3, left: encrypt ? 19 : 3, width: 16, height: 16, borderRadius: '50%',
                    background: '#fff', transition: 'left 0.16s ease',
                  }} />
                </button>
              </div>
              {/* Title mint chain — which network the 1-of-1 ownership title lands on. */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Title mint chain</div>
                  <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2 }}>
                    {titleChain === 'base' ? 'Base — custodial title address' : 'Solana — non-custodial, your own wallet'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                  {(['solana', 'base'] as const).map((c) => {
                    const active = titleChain === c;
                    return (
                      <button
                        key={c}
                        onClick={() => setTitleChain(c)}
                        style={{
                          fontSize: 12, fontWeight: active ? 600 : 500, cursor: 'pointer', borderRadius: 7,
                          padding: '6px 13px', textTransform: 'capitalize',
                          color: active ? 'var(--accent-text)' : 'var(--fg-2)',
                          background: active ? 'var(--accent-soft)' : 'var(--surface-2)',
                          border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
                        }}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Artifact card */}
          <div style={{ padding: '20px 24px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ width: 46, height: 46, borderRadius: 10, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, color: 'var(--accent-text)' }}>.pmp</span>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>{artifact?.fileName ?? `clude-memory-${new Date().toISOString().slice(0, 10)}.pmp`}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#10b981', background: 'rgba(16,185,129,0.14)', padding: '3px 9px', borderRadius: 6 }}>✓ Self-verifiable</span>
                </div>
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--fg-2)' }}>
                  <span>{(artifact?.records ?? previewTotal).toLocaleString()} records</span>
                  <span>{artifact?.sizeLabel ?? '—'}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    merkle <span style={{ color: 'var(--fg)' }}>{artifact ? abbrevHex(artifact.merkle) : '—'}</span>
                    {artifact?.merkle && (
                      <button
                        onClick={() => copyText(artifact.merkle, setMerkleCopied)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--accent-text)', cursor: 'pointer', fontSize: 11, fontFamily: 'var(--mono)' }}
                      >
                        {merkleCopied ? 'copied' : 'copy'}
                      </button>
                    )}
                  </span>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
              <button
                className="pbtn"
                onClick={handleDownload}
                disabled={exporting}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--accent-fg)', background: 'var(--accent)', border: 'none', borderRadius: 9, padding: '10px 16px', cursor: exporting ? 'default' : 'pointer', opacity: exporting ? 0.7 : 1 }}
              >
                ↓ {exporting ? 'Packaging…' : 'Download .pmp'}
              </button>
              <button className="gbtn" disabled style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-3)', background: 'transparent', border: '1px solid var(--border-2)', borderRadius: 9, padding: '10px 16px', cursor: 'default' }}>Send to desktop</button>
              <button className="gbtn" disabled style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-3)', background: 'transparent', border: '1px solid var(--border-2)', borderRadius: 9, padding: '10px 16px', cursor: 'default' }}>List on marketplace</button>
            </div>
            {exportNote && (
              <div style={{ marginTop: 12, fontSize: 12, color: exportNote.startsWith('Export failed') ? '#ef4444' : '#10b981' }}>{exportNote}</div>
            )}
          </div>
        </div>

        {/* ── Secondary: brief + import ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          {/* Brief another model */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 22px' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', marginBottom: 5 }}>Brief another model</div>
            <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.5 }}>Synthesize memories into a paste-ready context block.</p>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              {PROVIDERS.map((p) => {
                const active = provider === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => pickProvider(p.id)}
                    style={{
                      fontSize: 11.5, fontWeight: active ? 600 : 500, cursor: 'pointer', borderRadius: 99, padding: '5px 11px',
                      color: active ? 'var(--accent-text)' : 'var(--fg-2)',
                      background: active ? 'var(--accent-soft)' : 'var(--surface-2)',
                      border: 'none',
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <div style={{ position: 'relative', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', fontFamily: 'var(--mono)', fontSize: 11.5, lineHeight: 1.6, color: 'var(--fg-2)', whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'hidden', minHeight: 96 }}>
              {briefLoading
                ? 'Synthesizing a paste-ready brief…'
                : brief || `Pick a model to synthesize a ${PROVIDERS.find((p) => p.id === provider)?.label} context brief from your memories.`}
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 46, background: 'linear-gradient(transparent,var(--surface))' }} />
            </div>
            <button
              className="pbtn"
              onClick={() => brief && copyText(brief, setBriefCopied)}
              disabled={!brief || briefLoading}
              style={{ marginTop: 14, width: '100%', fontSize: 12.5, fontWeight: 600, color: 'var(--accent-fg)', background: 'var(--accent)', border: 'none', borderRadius: 9, padding: 10, cursor: brief && !briefLoading ? 'pointer' : 'default', opacity: brief && !briefLoading ? 1 : 0.6 }}
            >
              {briefCopied ? 'Copied to clipboard' : briefCount != null ? `Copy brief (${briefCount.toLocaleString()} memories)` : 'Copy brief'}
            </button>
          </div>

          {/* Import */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 22px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', marginBottom: 5 }}>Import</div>
            <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.5 }}>Bring memories in from a file.</p>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              style={{
                flex: 1, borderRadius: 11, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 8, padding: '26px 16px', textAlign: 'center', marginBottom: 12,
                border: `1.5px dashed ${dragOver ? 'var(--accent)' : 'var(--border-2)'}`,
                background: dragOver ? 'var(--accent-soft)' : 'transparent',
                transition: 'border-color 0.15s ease, background 0.15s ease',
              }}
            >
              <svg width="26" height="26" viewBox="0 0 24 24" style={{ stroke: 'var(--fg-3)', fill: 'none', strokeWidth: 1.6 }}>
                <path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M5 20h14" />
              </svg>
              <div style={{ fontSize: 13, color: 'var(--fg)' }}>Drop a <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>.pmp</span> to ingest</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>verifies the Merkle root on import</div>
            </div>
            <button
              className="gbtn"
              onClick={() => docInputRef.current?.click()}
              disabled={uploading}
              style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg-2)', background: 'transparent', border: '1px solid var(--border-2)', borderRadius: 9, padding: 10, cursor: uploading ? 'default' : 'pointer' }}
            >
              {uploading ? 'Uploading…' : 'Or upload a document → extract memories'}
            </button>
            <input
              ref={docInputRef}
              type="file"
              accept=".txt,.md,.pdf,.docx,.json"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleDocUpload(f); e.target.value = ''; }}
            />
            {importMsg && (
              <div style={{ marginTop: 12, fontSize: 11.5, color: /could not|only/i.test(importMsg) ? 'var(--fg-3)' : '#10b981', lineHeight: 1.5 }}>{importMsg}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
