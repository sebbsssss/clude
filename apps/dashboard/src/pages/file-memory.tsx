import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import { useAuthContext } from '../hooks/AuthContext';

interface Batch {
  batch_id: string;
  document_title: string;
  file_name: string;
  status: string;
  total_nodes: number;
  total_chunks: number;
  chunks_completed: number;
  chunks_failed: number;
  chunks_pending: number;
  chunks_processing: number;
  created_at: string;
  error_message?: string;
}

interface BatchDetail {
  batch_id: string;
  document_title: string;
  file_name: string;
  status: string;
  chunks: Array<{ chunk_index: number; status: string; parsed_node_count: number; raw_response: string; error_message?: string }>;
  total_nodes: number;
  memories: Array<{ id: number; summary: string; tags: string[]; importance: number; created_at: string; metadata: any }>;
}

const STATUS_COLORS: Record<string, string> = {
  completed: '#10b981',
  processing: '#f59e0b',
  failed: '#ef4444',
  pending: '#6b7280',
};

export function FileMemory() {
  const { ready, authMode, walletAddress } = useAuthContext();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const [batchDetail, setBatchDetail] = useState<BatchDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [expandedChunk, setExpandedChunk] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadBatches = useCallback(async () => {
    try {
      const result = await api.listUploadBatches();
      setBatches(result.batches);
    } catch (err) {
      console.error('Failed to load batches:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (authMode === 'privy' && !walletAddress) return;

    loadBatches();
    const unsubscribe = api.onRefresh(() => {
      loadBatches();
    });
    return () => { unsubscribe(); };
  }, [loadBatches, ready, authMode, walletAddress]);

  // Poll for processing batches (list + expanded detail)
  useEffect(() => {
    const hasProcessing = batches.some(b => b.status === 'processing');
    if (!hasProcessing && !expandedBatch) return;
    const interval = setInterval(async () => {
      await loadBatches();
      if (expandedBatch) {
        try {
          const detail = await api.getUploadBatch(expandedBatch);
          setBatchDetail(detail);
        } catch { /* ignore */ }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [batches, loadBatches, expandedBatch]);

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    if (!title) {
      const name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
      setTitle(name);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const handleUpload = async () => {
    if (!selectedFile || !title.trim()) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const result = await api.uploadFile(selectedFile, title.trim());
      setUploadResult(`Processing started. Batch: ${result.batch_id.slice(0, 8)}...`);
      // Add optimistic entry immediately so it appears in the list
      setBatches(prev => [{
        batch_id: result.batch_id,
        document_title: result.document_title,
        file_name: result.file_name,
        status: 'processing',
        total_nodes: 0,
        total_chunks: 0,
        chunks_completed: 0,
        chunks_failed: 0,
        chunks_pending: 0,
        chunks_processing: 0,
        created_at: new Date().toISOString(),
      }, ...prev]);
      setSelectedFile(null);
      setTitle('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      setUploadResult(`Error: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleExpandBatch = async (batchId: string) => {
    if (expandedBatch === batchId) {
      setExpandedBatch(null);
      setBatchDetail(null);
      setExpandedChunk(null);
      return;
    }
    setExpandedBatch(batchId);
    setExpandedChunk(null);
    setDetailLoading(true);
    try {
      const detail = await api.getUploadBatch(batchId);
      setBatchDetail(detail);
    } catch (err) {
      console.error('Failed to load batch detail:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>
          FILE MEMORY
        </h1>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 0.5 }}>
          Upload documents to extract memory nodes and ingest them into the brain
        </p>
      </div>

      {/* Upload Area */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? 'var(--blue)' : 'var(--border-strong)'}`,
          borderRadius: 8,
          padding: '32px 24px',
          textAlign: 'center',
          cursor: 'pointer',
          background: dragOver ? 'var(--blue-light)' : 'var(--bg-card)',
          transition: 'all 0.2s',
          marginBottom: 16,
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.md"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelect(file);
          }}
        />
        {selectedFile ? (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              {selectedFile.name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {formatSize(selectedFile.size)} — Click to change
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.4 }}>
              +
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Drop a file here or click to browse
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 4 }}>
              PDF, TXT, MD — max 20MB
            </div>
          </div>
        )}
      </div>

      {/* Title + Upload button */}
      {selectedFile && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          <input
            type="text"
            placeholder="Document title..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{
              flex: 1,
              padding: '8px 12px',
              fontSize: 12,
              fontFamily: 'var(--mono)',
              background: 'var(--bg-card)',
              border: '1px solid var(--border-strong)',
              borderRadius: 4,
              color: 'var(--text)',
              outline: 'none',
            }}
          />
          <button
            onClick={handleUpload}
            disabled={uploading || !title.trim()}
            style={{
              padding: '8px 20px',
              fontSize: 11,
              fontFamily: 'var(--mono)',
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: 'uppercase' as const,
              background: uploading ? 'var(--text-faint)' : 'var(--blue)',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: uploading ? 'default' : 'pointer',
              opacity: uploading || !title.trim() ? 0.5 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {uploading ? 'Uploading...' : 'Process'}
          </button>
        </div>
      )}

      {/* Upload result */}
      {uploadResult && (
        <div style={{
          padding: '8px 12px',
          fontSize: 11,
          borderRadius: 4,
          marginBottom: 24,
          background: uploadResult.startsWith('Error') ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)',
          color: uploadResult.startsWith('Error') ? '#ef4444' : '#10b981',
          border: `1px solid ${uploadResult.startsWith('Error') ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)'}`,
        }}>
          {uploadResult}
        </div>
      )}

      {/* Batches List */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase' as const, color: 'var(--text-muted)', marginBottom: 12 }}>
          Processing History
        </h2>
      </div>

      {loading ? (
        <div style={{ fontSize: 11, color: 'var(--text-faint)', padding: 24, textAlign: 'center' }}>
          Loading...
        </div>
      ) : batches.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--text-faint)', padding: 24, textAlign: 'center', background: 'var(--bg-card)', borderRadius: 8 }}>
          No files processed yet. Upload a document above to get started.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {batches.map((batch) => (
            <div key={batch.batch_id}>
              {/* Batch row */}
              <div
                onClick={() => handleExpandBatch(batch.batch_id)}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: '8px 12px',
                  padding: '12px 16px',
                  background: expandedBatch === batch.batch_id ? 'var(--hover-bg-strong)' : 'var(--bg-card)',
                  borderRadius: expandedBatch === batch.batch_id ? '8px 8px 0 0' : 8,
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                  border: '1px solid var(--border)',
                  borderBottom: expandedBatch === batch.batch_id ? 'none' : '1px solid var(--border)',
                }}
                onMouseEnter={(e) => { if (expandedBatch !== batch.batch_id) e.currentTarget.style.background = 'var(--hover-bg)'; }}
                onMouseLeave={(e) => { if (expandedBatch !== batch.batch_id) e.currentTarget.style.background = 'var(--bg-card)'; }}
              >
                {/* Status dot */}
                <div style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: STATUS_COLORS[batch.status] || '#6b7280',
                  flexShrink: 0,
                  animation: batch.status === 'processing' ? 'sidebarPulse 2s ease-in-out infinite' : undefined,
                }} />

                {/* Title + progress bar */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {batch.document_title}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {batch.file_name}
                  </div>
                  {batch.total_chunks > 0 && batch.status !== 'completed' && (
                    <div style={{ marginTop: 4, height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        borderRadius: 2,
                        background: batch.chunks_failed > 0 ? '#ef4444' : '#10b981',
                        width: `${((batch.chunks_completed + batch.chunks_failed) / batch.total_chunks) * 100}%`,
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                  )}
                </div>

                {/* Stats + Status + Date row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'right' as const }}>
                    <div>{batch.total_nodes} nodes</div>
                    <div style={{ color: 'var(--text-faint)' }}>{batch.chunks_completed}/{batch.total_chunks} chunks</div>
                  </div>

                  <div style={{
                    fontSize: 9,
                    letterSpacing: 1,
                    textTransform: 'uppercase' as const,
                    padding: '2px 8px',
                    borderRadius: 2,
                    background: `${STATUS_COLORS[batch.status]}20`,
                    color: STATUS_COLORS[batch.status],
                    fontWeight: 600,
                  }}>
                    {batch.status}
                  </div>

                  <div style={{ fontSize: 10, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                    {formatDate(batch.created_at)}
                  </div>
                </div>
              </div>

              {/* Expanded detail */}
              {expandedBatch === batch.batch_id && (
                <div style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderTop: 'none',
                  borderRadius: '0 0 8px 8px',
                  padding: 16,
                }}>
                  {detailLoading ? (
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', textAlign: 'center', padding: 12 }}>
                      Loading details...
                    </div>
                  ) : batchDetail ? (
                    <div>
                      {/* Error message */}
                      {batch.error_message && (
                        <div style={{
                          fontSize: 11,
                          color: '#ef4444',
                          background: 'rgba(239,68,68,0.1)',
                          padding: '8px 12px',
                          borderRadius: 4,
                          marginBottom: 12,
                        }}>
                          {batch.error_message}
                        </div>
                      )}

                      {/* Chunks sub-table */}
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' as const, color: 'var(--text-muted)', marginBottom: 8 }}>
                          Chunks ({batchDetail.chunks.filter(c => c.status === 'completed').length}/{batchDetail.chunks.length} completed)
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 300, overflowY: 'auto' }}>
                          {batchDetail.chunks.map((chunk) => (
                            <div key={chunk.chunk_index}>
                              <div
                                onClick={() => setExpandedChunk(expandedChunk === chunk.chunk_index ? null : chunk.chunk_index)}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  padding: '6px 10px',
                                  background: expandedChunk === chunk.chunk_index ? 'var(--hover-bg-strong)' : 'var(--hover-bg)',
                                  borderRadius: expandedChunk === chunk.chunk_index ? '4px 4px 0 0' : 4,
                                  cursor: chunk.status === 'completed' ? 'pointer' : 'default',
                                  fontSize: 11,
                                }}
                              >
                                {/* Status dot */}
                                <div style={{
                                  width: 6, height: 6, borderRadius: '50%',
                                  background: STATUS_COLORS[chunk.status] || '#6b7280',
                                  flexShrink: 0,
                                  animation: chunk.status === 'processing' ? 'sidebarPulse 2s ease-in-out infinite' : undefined,
                                }} />
                                <span style={{ fontWeight: 600 }}>Chunk {chunk.chunk_index + 1}</span>
                                <span style={{ color: 'var(--text-muted)' }}>
                                  {chunk.status === 'completed' ? `${chunk.parsed_node_count} nodes extracted` :
                                   chunk.status === 'processing' ? 'processing...' :
                                   chunk.status === 'failed' ? chunk.error_message || 'failed' :
                                   'pending'}
                                </span>
                                {chunk.status === 'completed' && (
                                  <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-faint)' }}>
                                    {expandedChunk === chunk.chunk_index ? '▾' : '▸'}
                                  </span>
                                )}
                              </div>
                              {/* Expanded chunk raw response */}
                              {expandedChunk === chunk.chunk_index && chunk.raw_response && (
                                <div style={{
                                  background: 'var(--bg)',
                                  border: '1px solid var(--border)',
                                  borderTop: 'none',
                                  borderRadius: '0 0 4px 4px',
                                  padding: 10,
                                  maxHeight: 250,
                                  overflowY: 'auto',
                                }}>
                                  <pre style={{
                                    fontSize: 10,
                                    lineHeight: 1.5,
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                    color: 'var(--text-muted)',
                                    margin: 0,
                                    fontFamily: 'var(--mono)',
                                  }}>
                                    {chunk.raw_response}
                                  </pre>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Extracted memories */}
                      {batchDetail.memories.length > 0 && (
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' as const, color: 'var(--text-muted)', marginBottom: 8 }}>
                            Extracted Nodes ({batchDetail.memories.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 400, overflowY: 'auto' }}>
                            {batchDetail.memories.map((mem) => {
                              const entities = (mem.metadata?.entities as string[]) || [];
                              return (
                                <div
                                  key={mem.id}
                                  style={{
                                    padding: '8px 12px',
                                    background: 'var(--hover-bg)',
                                    borderRadius: 4,
                                    fontSize: 11,
                                  }}
                                >
                                  <div style={{ fontWeight: 600, marginBottom: 2 }}>
                                    {mem.summary.length > 200 ? mem.summary.slice(0, 200) + '...' : mem.summary}
                                  </div>
                                  {entities.length > 0 && (
                                    <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                                      {entities.map((e) => (
                                        <span
                                          key={e}
                                          style={{
                                            fontSize: 9,
                                            padding: '1px 6px',
                                            background: 'var(--self-model)',
                                            color: '#fff',
                                            borderRadius: 2,
                                            fontWeight: 600,
                                          }}
                                        >
                                          {e}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 4 }}>
                                    Memory #{mem.id} — importance: {mem.importance.toFixed(2)}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
