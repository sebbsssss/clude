import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { X, FileJson } from 'lucide-react';

interface Props {
  onImport: (pack: any) => Promise<number>;
  onClose: () => void;
}

export function MemoryImportModal({ onImport, onClose }: Props) {
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setResult(null);
    setImporting(true);
    try {
      const text = await file.text();
      const pack = JSON.parse(text);
      const count = await onImport(pack);
      setResult(`Imported ${count} memories`);
    } catch (err: any) {
      setError(err.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  }, [onImport]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white text-sm font-medium">Import Memory Pack</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            dragging ? 'border-blue-500 bg-blue-500/10' : 'border-zinc-700 hover:border-zinc-600'
          }`}
        >
          <FileJson className="h-8 w-8 mx-auto mb-3 text-zinc-500" />
          <p className="text-zinc-400 text-xs mb-2">
            {importing ? 'Importing...' : 'Drop a .json memory pack here'}
          </p>
          <label className="text-blue-400 text-xs cursor-pointer hover:text-blue-300">
            or browse files
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </label>
        </div>

        {result && <p className="mt-3 text-green-400 text-xs text-center">{result}</p>}
        {error && <p className="mt-3 text-red-400 text-xs text-center">{error}</p>}
      </motion.div>
    </motion.div>
  );
}
