import { useAuthContext } from '../hooks/AuthContext';

export function BrainView() {
  const { walletAddress } = useAuthContext();

  const brainUrl = `/brain.html${walletAddress ? '?wallet=' + encodeURIComponent(walletAddress) : ''}`;

  return (
    <div style={{
      height: 'calc(100vh - 80px)',
      position: 'relative',
      overflow: 'hidden',
      margin: '-40px',
    }}>
      <iframe
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
