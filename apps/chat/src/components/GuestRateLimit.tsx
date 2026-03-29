import { useAuthContext } from '../hooks/AuthContext';

interface Props {
  remaining: number | null;
}

export function GuestRateLimit({ remaining }: Props) {
  const { authenticated, login } = useAuthContext();
  if (authenticated || remaining === null) return null;

  const atLimit = remaining <= 0;

  return (
    <div className="text-center py-2">
      {atLimit ? (
        <button
          onClick={login}
          className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
        >
          Free messages used up. Sign in for unlimited.
        </button>
      ) : (
        <span className="text-[10px] text-zinc-600">
          {remaining} of 10 free messages remaining
        </span>
      )}
    </div>
  );
}
