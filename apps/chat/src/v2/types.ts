// Clude Chat v2 — local design-system types.
// These mirror the JSX prototype's CC_MEMORIES / CC_MODELS shapes so the
// component tree maps 1:1 to the design bundle.

export type MemoryType =
  | 'episodic'
  | 'semantic'
  | 'procedural'
  | 'self_model'
  | 'introspective';

export interface V2Model {
  id: string;
  name: string;
  sub: string;
  /** Short chip label — usually the tier (FREE/PRO) or a custom tag. */
  tag: string;
  /** True for free/open models — swaps the picker dot color. */
  free: boolean;
  default?: boolean;
  /** Vision-capable: composer shows the image-attach button when true. */
  supportsVision?: boolean;
}

export interface V2Memory {
  id: string | number;
  type: MemoryType;
  content: string;
  importance: number;
  decay: number;
  timestamp: string;
  accessed: number;
}

export interface V2Thread {
  id: string;
  title: string;
  group: 'today' | 'yesterday' | 'this_week' | 'older';
  meta: string;
  active?: boolean;
}

export interface V2Tokens {
  clude: number;
  frontier: number;
  model: string;
}

export type V2Layout = 'sidebar-left' | 'sidebar-right' | 'sidebar-none';
export type V2Theme = 'light' | 'dark';
export type V2AppState = 'logged-out' | 'onboarding' | 'logged-in';

export const MEMORY_COLORS: Record<MemoryType, string> = {
  episodic: '#2244FF',
  semantic: '#10B981',
  procedural: '#F59E0B',
  self_model: '#8B5CF6',
  introspective: '#EC4899',
};
