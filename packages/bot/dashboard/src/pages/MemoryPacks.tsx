import { useState } from 'react';
import { api } from '../lib/api';
import { useAuthContext } from '../hooks/AuthContext';
import { packToMarkdown, downloadMarkdown } from '../lib/export-markdown';

export function MemoryPacks() {
  const { authMode } = useAuthContext();
  const [exportName, setExportName] = useState('');
  const [exportDesc, setExportDesc] = useState('');
  const [exportTags, setExportTags] = useState('');
  const [exportFormat, setExportFormat] = useState<'json' | 'md'>('json');
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<any>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string>('');

  async function handleExport() {
    if (!exportName) return;
    setExporting(true);
    try {
      const pack = await api.exportMemoryPack({
        name: exportName,
        description: exportDesc,
        tags: exportTags ? exportTags.split(',').map(t => t.trim()) : undefined,
      });
      setExportResult(pack);

      const slug = exportName.replace(/\s+/g, '-').toLowerCase();
      if (exportFormat === 'md') {
        downloadMarkdown(packToMarkdown(pack), `${slug}.clude-pack.md`);
      } else {
        const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${slug}.clude-pack.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err: any) {
      setExportResult({ error: err.message });
    }
    setExporting(false);
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

  return (
    <div>
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 12 }}>
          Memory Packs
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, marginBottom: 8 }}>
          Export & Import
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Package memories for sharing or transfer between agents.
        </p>
      </div>

      {authMode === 'cortex' ? (
        <div style={{
          border: '1px solid var(--border)',
          padding: '40px 20px',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: 13,
          lineHeight: 1.8,
        }}>
          <div style={{ fontSize: 24, opacity: 0.2, marginBottom: 16 }}>▦</div>
          Memory packs require self-hosted mode.<br />
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            Set up your own Supabase to export and import memory packs.
          </span>
        </div>
      ) : (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Export */}
        <div style={{ border: '1px solid var(--border)' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 600 }}>
            Export Memory Pack
          </div>
          <div style={{ padding: 20 }}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 6 }}>
                Pack Name
              </label>
              <input
                type="text"
                value={exportName}
                onChange={(e) => setExportName(e.target.value)}
                placeholder="e.g. DeFi Trading Patterns"
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 12,
                  padding: '8px 12px',
                  border: '1px solid var(--border-strong)',
                  background: 'transparent',
                  width: '100%',
                  outline: 'none',
                }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 6 }}>
                Description
              </label>
              <textarea
                value={exportDesc}
                onChange={(e) => setExportDesc(e.target.value)}
                placeholder="What knowledge does this pack contain?"
                rows={3}
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 12,
                  padding: '8px 12px',
                  border: '1px solid var(--border-strong)',
                  background: 'transparent',
                  width: '100%',
                  outline: 'none',
                  resize: 'vertical',
                }}
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 6 }}>
                Filter by Tags (comma-separated)
              </label>
              <input
                type="text"
                value={exportTags}
                onChange={(e) => setExportTags(e.target.value)}
                placeholder="e.g. defi, trading, pattern"
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 12,
                  padding: '8px 12px',
                  border: '1px solid var(--border-strong)',
                  background: 'transparent',
                  width: '100%',
                  outline: 'none',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {(['json', 'md'] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setExportFormat(fmt)}
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 10,
                    letterSpacing: 1,
                    textTransform: 'uppercase',
                    padding: '6px 14px',
                    border: `1px solid ${exportFormat === fmt ? 'var(--text)' : 'var(--border-strong)'}`,
                    background: exportFormat === fmt ? 'var(--text)' : 'transparent',
                    color: exportFormat === fmt ? 'var(--bg)' : 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  {fmt === 'json' ? 'JSON (agents)' : 'Markdown (humans)'}
                </button>
              ))}
            </div>

            <button
              onClick={handleExport}
              disabled={!exportName || exporting}
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 10,
                letterSpacing: 2,
                textTransform: 'uppercase',
                padding: '10px 20px',
                background: exportName ? 'var(--text)' : 'var(--border-strong)',
                color: exportName ? 'var(--bg)' : 'var(--text-faint)',
                border: 'none',
                width: '100%',
                cursor: exportName ? 'pointer' : 'not-allowed',
              }}
            >
              {exporting ? 'Exporting...' : 'Export & Download'}
            </button>

            {exportResult && !exportResult.error && (
              <div style={{ marginTop: 16, fontSize: 11, color: 'var(--semantic)' }}>
                Exported {exportResult.memory_count || exportResult.memories?.length || 0} memories,{' '}
                {exportResult.entity_count || exportResult.entities?.length || 0} entities.
              </div>
            )}
            {exportResult?.error && (
              <div style={{ marginTop: 16, fontSize: 11, color: '#ef4444' }}>
                {exportResult.error}
              </div>
            )}
          </div>
        </div>

        {/* Import */}
        <div style={{ border: '1px solid var(--border)' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 600 }}>
            Import Memory Pack
          </div>
          <div style={{ padding: 20 }}>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 6 }}>
                Select .clude-pack.json file
              </label>
              <input
                type="file"
                accept=".json"
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 11,
                  color: 'var(--text-muted)',
                }}
              />
            </div>

            <button
              onClick={handleImport}
              disabled={!importFile || importing}
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 10,
                letterSpacing: 2,
                textTransform: 'uppercase',
                padding: '10px 20px',
                background: importFile ? 'var(--text)' : 'var(--border-strong)',
                color: importFile ? 'var(--bg)' : 'var(--text-faint)',
                border: 'none',
                width: '100%',
                cursor: importFile ? 'pointer' : 'not-allowed',
              }}
            >
              {importing ? 'Importing...' : 'Import Memories'}
            </button>

            {importResult && (
              <div style={{ marginTop: 16, fontSize: 11, color: importResult.startsWith('Error') ? '#ef4444' : 'var(--semantic)' }}>
                {importResult}
              </div>
            )}

            <div style={{ marginTop: 32, padding: 16, background: 'var(--bg-warm)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Coming Soon</div>
              <div>On-chain memory marketplace. License memory packs for $CLUDE. Smart contract verification for pack authenticity.</div>
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
