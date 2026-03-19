import { useState } from 'react';
import { api } from '../lib/api';
import { useAuthContext } from '../hooks/AuthContext';
import { packToMarkdown, downloadMarkdown } from '../lib/export-markdown';
import {
  type ExportFormat,
  FORMAT_LABELS,
  isProviderFormat,
  formatForProvider,
  downloadText,
  copyToClipboard,
  wordCount,
  getFileExtension,
} from '../lib/export-providers';

type SmartProvider = 'chatgpt' | 'claude' | 'gemini';

const PROVIDERS: { id: SmartProvider; name: string; icon: string; hint: string; color: string }[] = [
  { id: 'claude', name: 'Claude', icon: '◈', hint: 'Paste into Claude → Project → Project Instructions', color: '#c96' },
  { id: 'chatgpt', name: 'ChatGPT', icon: '◉', hint: 'Paste into ChatGPT → Settings → Custom Instructions', color: '#10b981' },
  { id: 'gemini', name: 'Gemini', icon: '◎', hint: 'Paste into Gemini → Create a Gem → Instructions', color: '#4285f4' },
];

export function MemoryPacks() {
  const { authMode } = useAuthContext();
  const [exportName, setExportName] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<SmartProvider>('claude');
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [lastExportText, setLastExportText] = useState('');
  const [showOther, setShowOther] = useState(false);
  const [otherFormat, setOtherFormat] = useState<ExportFormat>('json');
  const [exportDesc, setExportDesc] = useState('');
  const [exportTags, setExportTags] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState('');

  async function handleSmartExport() {
    if (!exportName) return;
    setExporting(true);
    setCopied(false);
    setLastExportText('');
    setExportResult(null);
    try {
      const result = await api.smartExport(exportName, selectedProvider);
      setExportResult(result);
      setLastExportText(result.content);
      const slug = exportName.replace(/\s+/g, '-').toLowerCase();
      downloadText(result.content, `${slug}-${selectedProvider}.context-brief.txt`);
    } catch (err: any) {
      setExportResult({ error: err.message });
    }
    setExporting(false);
  }

  async function handleOtherExport() {
    if (!exportName) return;
    setExporting(true);
    setCopied(false);
    setLastExportText('');
    setExportResult(null);
    try {
      const slug = exportName.replace(/\s+/g, '-').toLowerCase();
      const pack = await api.exportMemoryPack({
        name: exportName,
        description: exportDesc,
        tags: exportTags ? exportTags.split(',').map(t => t.trim()) : undefined,
      });
      setExportResult(pack);

      if (isProviderFormat(otherFormat)) {
        const text = formatForProvider(pack.memories, otherFormat);
        setLastExportText(text);
        downloadText(text, `${slug}${getFileExtension(otherFormat)}`);
      } else if (otherFormat === 'md') {
        downloadMarkdown(packToMarkdown(pack), `${slug}${getFileExtension('md')}`);
      } else {
        const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${slug}${getFileExtension('json')}`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err: any) {
      setExportResult({ error: err.message });
    }
    setExporting(false);
  }

  async function handleCopy() {
    if (!lastExportText) return;
    try {
      await navigator.clipboard.writeText(lastExportText);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = lastExportText; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleImport() {
    if (!importFile) return;
    setImporting(true);
    try {
      const text = await importFile.text();
      const pack = JSON.parse(text);
      const result = await api.importMemoryPack(pack);
      setImportResult(`Imported ${result.imported} memories successfully.`);
    } catch (err: any) {
      setImportResult(`Error: ${err.message}`);
    }
    setImporting(false);
  }

  const currentProvider = PROVIDERS.find(p => p.id === selectedProvider)!;

  return (
    <div>
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 12 }}>
          Memory Packs
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, marginBottom: 8 }}>
          Export & Import
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          Export your memories as an AI-synthesized context brief. Paste it into any LLM to carry your memory across platforms.
        </p>
      </div>

      {/* ── Smart Export (Primary) ── */}
      <div style={{ border: '1px solid var(--border)', marginBottom: 24 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 600 }}>
          Smart Export
        </div>
        <div style={{ padding: 20 }}>

          {/* Export name */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 6 }}>
              Export Name
            </label>
            <input
              type="text"
              value={exportName}
              onChange={(e) => setExportName(e.target.value)}
              placeholder="e.g. My Agent Context"
              style={{
                fontFamily: 'var(--mono)', fontSize: 12, padding: '10px 12px',
                border: '1px solid var(--border-strong)', background: 'transparent',
                width: '100%', maxWidth: 400, outline: 'none',
              }}
            />
          </div>

          {/* Provider selector */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8 }}>
              Export for
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              {PROVIDERS.map(p => (
                <button
                  key={p.id}
                  onClick={() => { setSelectedProvider(p.id); setLastExportText(''); setCopied(false); setExportResult(null); }}
                  style={{
                    fontFamily: 'var(--mono)', fontSize: 12, padding: '12px 20px',
                    border: `1px solid ${selectedProvider === p.id ? 'var(--text)' : 'var(--border-strong)'}`,
                    background: selectedProvider === p.id ? 'var(--text)' : 'transparent',
                    color: selectedProvider === p.id ? 'var(--bg)' : 'var(--text-muted)',
                    cursor: 'pointer', transition: 'all 0.15s',
                    display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600,
                  }}
                >
                  <span style={{ fontSize: 16 }}>{p.icon}</span>
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Hint */}
          <div style={{
            marginBottom: 20, padding: '10px 14px',
            background: 'var(--bg-warm)', border: '1px solid var(--border)',
            fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6,
          }}>
            {currentProvider.hint}
          </div>

          {/* Export button */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleSmartExport}
              disabled={!exportName || exporting}
              style={{
                fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: 2,
                textTransform: 'uppercase', padding: '12px 24px',
                background: exportName ? 'var(--blue)' : 'var(--border-strong)',
                color: exportName ? '#fff' : 'var(--text-faint)',
                border: 'none', cursor: exportName ? 'pointer' : 'not-allowed',
                flex: 1,
              }}
            >
              {exporting ? 'Synthesizing with AI...' : `Export for ${currentProvider.name}`}
            </button>

            {lastExportText && (
              <button
                onClick={handleCopy}
                style={{
                  fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 2,
                  textTransform: 'uppercase', padding: '12px 20px',
                  background: copied ? '#10b981' : 'var(--text)',
                  color: 'var(--bg)', border: 'none', cursor: 'pointer',
                  transition: 'background 0.2s', whiteSpace: 'nowrap',
                }}
              >
                {copied ? 'Copied!' : 'Copy to Clipboard'}
              </button>
            )}
          </div>

          {/* Result */}
          {exportResult && !exportResult.error && (
            <div style={{ marginTop: 16, fontSize: 11, color: '#10b981' }}>
              Synthesized {exportResult.memory_count || 0} memories into context brief
              {lastExportText && <span style={{ color: 'var(--text-faint)', marginLeft: 8 }}>({wordCount(lastExportText)} words)</span>}
            </div>
          )}
          {exportResult?.error && (
            <div style={{
              marginTop: 16, fontSize: 11, color: '#ef4444',
              padding: '10px 14px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)',
            }}>
              {exportResult.error}
            </div>
          )}

          {/* Preview */}
          {lastExportText && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 6 }}>
                Preview
              </div>
              <pre style={{
                fontFamily: 'var(--mono)', fontSize: 10, lineHeight: 1.6,
                background: 'var(--bg-warm)', border: '1px solid var(--border)',
                padding: 14, maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {lastExportText.slice(0, 2000)}{lastExportText.length > 2000 ? '\n\n... (truncated in preview)' : ''}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* ── Other Options (Collapsed) ── */}
      <details open={showOther} onToggle={e => setShowOther((e.target as HTMLDetailsElement).open)} style={{ border: '1px solid var(--border)', marginBottom: 24 }}>
        <summary style={{
          padding: '14px 20px', cursor: 'pointer',
          fontSize: 10, letterSpacing: 2, textTransform: 'uppercase',
          color: 'var(--text-faint)', fontWeight: 600, listStyle: 'none',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 12, transition: 'transform 0.2s', transform: showOther ? 'rotate(90deg)' : 'none' }}>{'\u25B8'}</span>
          Other Export Formats
        </summary>
        <div style={{ padding: '0 20px 20px' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {(['json', 'md', 'chatgpt', 'claude', 'gemini'] as ExportFormat[]).map(fmt => (
              <button
                key={fmt}
                onClick={() => setOtherFormat(fmt)}
                style={{
                  fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 1,
                  textTransform: 'uppercase', padding: '6px 12px',
                  border: `1px solid ${otherFormat === fmt ? 'var(--text)' : 'var(--border-strong)'}`,
                  background: otherFormat === fmt ? 'var(--text)' : 'transparent',
                  color: otherFormat === fmt ? 'var(--bg)' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                {FORMAT_LABELS[fmt]}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 12 }}>
            {otherFormat === 'json' ? 'Raw JSON with all memory data — for agent-to-agent transfer.' :
             otherFormat === 'md' ? 'Markdown format — human-readable export.' :
             'Basic template format (no AI synthesis). Use Smart Export above for better results.'}
          </div>
          <button
            onClick={handleOtherExport}
            disabled={!exportName || exporting}
            style={{
              fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 2,
              textTransform: 'uppercase', padding: '10px 20px',
              background: exportName ? 'var(--text)' : 'var(--border-strong)',
              color: exportName ? 'var(--bg)' : 'var(--text-faint)',
              border: 'none', cursor: exportName ? 'pointer' : 'not-allowed',
            }}
          >
            {exporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </details>

      {/* ── Import ── */}
      <details style={{ border: '1px solid var(--border)' }}>
        <summary style={{
          padding: '14px 20px', cursor: 'pointer',
          fontSize: 10, letterSpacing: 2, textTransform: 'uppercase',
          color: 'var(--text-faint)', fontWeight: 600, listStyle: 'none',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 12 }}>{'\u25B8'}</span>
          Import Memory Pack
        </summary>
        <div style={{ padding: '0 20px 20px' }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 6 }}>
              Select .clude-pack.json file
            </label>
            <input
              type="file"
              accept=".json"
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)' }}
            />
          </div>
          <button
            onClick={handleImport}
            disabled={!importFile || importing}
            style={{
              fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 2,
              textTransform: 'uppercase', padding: '10px 20px',
              background: importFile ? 'var(--text)' : 'var(--border-strong)',
              color: importFile ? 'var(--bg)' : 'var(--text-faint)',
              border: 'none', cursor: importFile ? 'pointer' : 'not-allowed',
            }}
          >
            {importing ? 'Importing...' : 'Import'}
          </button>
          {importResult && (
            <div style={{ marginTop: 12, fontSize: 11, color: importResult.startsWith('Error') ? '#ef4444' : '#10b981' }}>
              {importResult}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
