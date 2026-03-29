import { useAuthContext } from '../hooks/AuthContext';

export function BrainView() {
  const { walletAddress, ready } = useAuthContext();

  if (!ready || !walletAddress) {
    return (
      <div style={{
        height: 'calc(100vh - 80px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#a1a1aa',
        fontSize: '14px',
      }}>
        Loading wallet...
      </div>
    );
  }

  const brainUrl = `/brain.html?wallet=${encodeURIComponent(walletAddress)}`;

  return (
    <div style={{
      height: 'calc(100vh - 80px)',
      position: 'relative',
      overflow: 'hidden',
      margin: '-40px',
    }}>
      <iframe
        key={walletAddress}
        src={brainUrl}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          display: 'block',
        }}
        title="Clude Brain"
      />
    </div>
  );
}
