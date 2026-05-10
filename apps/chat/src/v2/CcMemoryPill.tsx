export function CcMemoryPill({
  recalledCount,
  storedCount,
  onOpen,
}: {
  recalledCount: number;
  storedCount: number;
  onOpen: () => void;
}) {
  // Pre-recall presence: when the user hasn't sent a message yet, surface the
  // stored count instead of "0 active". Honest because the memory IS ready —
  // it just hasn't been pulled into this thread yet.
  const showStored = recalledCount === 0 && storedCount > 0;
  const meta = showStored
    ? `${storedCount.toLocaleString()} ${storedCount === 1 ? 'memory' : 'memories'} ready`
    : `${recalledCount} ${recalledCount === 1 ? 'memory' : 'memories'} active`;

  return (
    <div className="cc-mpill" role="status" aria-label="Memory state">
      <span className="cc-mpill__dot" />
      <span className="cc-mpill__lead">
        {recalledCount > 0 ? 'Continuing your thread' : 'New thread — memory ready'}
      </span>
      <span className="cc-mpill__sep">·</span>
      <span className="cc-mpill__meta">{meta}</span>
      <button type="button" className="cc-mpill__btn" onClick={onOpen}>
        Inspect ↗
      </button>
    </div>
  );
}
