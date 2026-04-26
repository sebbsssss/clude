import type { ChatModel } from '../lib/types';
import type { V2Model, V2Thread } from './types';

/**
 * Convert a server `ChatModel` into the shape the v2 picker consumes.
 * The design bundle shipped with invented IDs (e.g. "clude-cortex-7b");
 * we only surface what the server actually accepts on /api/chat/messages.
 */
export function toV2Model(m: ChatModel): V2Model {
  const ctxLabel =
    m.context >= 1_000_000
      ? `${Math.round(m.context / 1_000_000)}M ctx`
      : m.context >= 1_000
      ? `${Math.round(m.context / 1_000)}k ctx`
      : `${m.context} ctx`;
  const privacyLabel = m.privacy === 'private' ? 'Private' : 'Anonymized';
  const tierLabel = m.tier === 'free' ? 'Free' : 'Pro';
  return {
    id: m.id,
    name: m.name,
    sub: `${tierLabel} · ${privacyLabel} · ${ctxLabel}`,
    tag: m.tier.toUpperCase(),
    free: m.tier === 'free',
    default: m.default,
  };
}

// Onboarding interest pills — seed semantic memories (kept for when/if we
// wire the post-register flow; unused today).
export const V2_INTERESTS = [
  'Rust', 'TypeScript', 'ROS 2', 'robotics', 'Zenoh/DDS', 'embedded',
  'React', 'agents/MCP', 'Solana', 'systems programming', 'ML research', 'product eng',
];

export const V2_THREAD_GROUPS: Array<{ id: V2Thread['group']; label: string }> = [
  { id: 'today',     label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'this_week', label: 'This Week' },
  { id: 'older',     label: 'Older' },
];
