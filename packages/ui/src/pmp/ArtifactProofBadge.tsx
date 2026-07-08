import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { evaluateProofBundle, type ProofBundleLike } from './proof-verify';

/**
 * ArtifactProofBadge (Memory 3.0 · B2 trust surface).
 *
 * The citation chip: a small pill that tells the user whether this pack's
 * commitment is Clude-signed (attestation verified IN THIS BROWSER via
 * tweetnacl — the server that served the bundle is not trusted) and whether
 * it carries an on-chain receipt (Solscan link).
 *
 * Thin by design: every decision lives in evaluateProofBundle (tested);
 * this component only renders its verdict. Props-based per @clude/ui
 * conventions so chat + dashboard mount it with their own fetch layers.
 */

export interface ArtifactProofBadgeProps {
  /** The bundle from GET /v1/pmp/artifacts/:id/proof (or the export response). */
  proof: ProofBundleLike;
  /**
   * The published Clude proof-plane pubkey (base58). STRONGLY recommended:
   * without it, a self-consistent signature from any key shows as signed.
   */
  expectedPubkeyB58?: string;
  theme?: 'light' | 'dark';
  style?: CSSProperties;
}

const COLORS = {
  dark: {
    success: '#4ade80',
    successBg: 'rgba(74,222,128,0.12)',
    accent: '#7dd3fc',
    accentBg: 'rgba(125,211,252,0.12)',
    danger: '#f87171',
    dangerBg: 'rgba(248,113,113,0.12)',
    faint: 'rgba(255,255,255,0.45)',
    faintBg: 'rgba(255,255,255,0.06)',
    link: '#7dd3fc',
  },
  light: {
    success: '#15803d',
    successBg: 'rgba(21,128,61,0.10)',
    accent: '#0369a1',
    accentBg: 'rgba(3,105,161,0.08)',
    danger: '#b91c1c',
    dangerBg: 'rgba(185,28,28,0.08)',
    faint: 'rgba(0,0,0,0.45)',
    faintBg: 'rgba(0,0,0,0.05)',
    link: '#0369a1',
  },
} as const;

export function ArtifactProofBadge({ proof, expectedPubkeyB58, theme = 'dark', style }: ArtifactProofBadgeProps) {
  const ev = useMemo(
    () => evaluateProofBundle(proof, { expectedPubkeyB58 }),
    [proof, expectedPubkeyB58],
  );
  const c = COLORS[theme];

  // Render matrix. Present-but-INVALID is loud (danger); absent is quiet (faint):
  // a missing attestation is a pre-rollout pack, a failing one is a red flag.
  const view =
    ev.attestationValid === false
      ? {
          label: ev.pubkeyMismatch ? 'Signed by unknown key' : 'Signature check failed',
          color: c.danger,
          bg: c.dangerBg,
          dot: c.danger,
        }
      : ev.status === 'attested+anchored'
        ? { label: 'Verified · signed + on-chain', color: c.success, bg: c.successBg, dot: c.success }
        : ev.status === 'attested'
          ? { label: 'Clude-signed', color: c.success, bg: c.successBg, dot: c.success }
          : ev.status === 'anchored'
            ? { label: 'On-chain receipt', color: c.accent, bg: c.accentBg, dot: c.accent }
            : { label: 'No proof yet', color: c.faint, bg: c.faintBg, dot: c.faint };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        color: view.color,
        background: view.bg,
        ...style,
      }}
      title={
        ev.attestationValid
          ? 'The ed25519 attestation was verified in your browser against the Clude proof-plane key.'
          : ev.attestationValid === false
            ? 'The attestation served for this pack did NOT verify. Do not trust its contents.'
            : 'This pack predates attestation or has not been anchored yet.'
      }
    >
      <span
        aria-hidden
        style={{ width: 6, height: 6, borderRadius: '50%', background: view.dot, flexShrink: 0 }}
      />
      {view.label}
      {ev.explorerUrl && ev.attestationValid !== false && (
        <a
          href={ev.explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: c.link, textDecoration: 'none', borderBottom: `1px dotted ${c.link}` }}
        >
          Solscan
        </a>
      )}
    </span>
  );
}
