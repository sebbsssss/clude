import type { LifeScript, PlantedFact, RenderStyle } from './life-script';

// ============================================================
// Renderers turn a planted fact into a natural dialogue utterance.
//
// TemplateRenderer is deterministic + offline (for tests + a no-API smoke
// dataset). TeacherRenderer (interface) is the scale path: a DeepSeek/Qwen
// call that paraphrases the fact in the requested style. Labels never depend
// on the rendering, so swapping renderers cannot corrupt ground truth.
// ============================================================

export interface Renderer {
  render(fact: PlantedFact): Promise<string> | string;
}

const STYLE_TEMPLATES: Record<RenderStyle, (t: string) => string> = {
  // explicit: states the fact plainly
  explicit: (t) => t,
  // implicit: embeds it in a longer sentence, fact not the headline
  implicit: (t) => `By the way, around then ${lowerFirst(t)} It came up while we were chatting.`,
  // hedged: softens with uncertainty markers
  hedged: (t) => `I think ${lowerFirst(t)} At least that's my sense of it.`,
  // corrected: presents as a correction of a prior belief
  corrected: (t) => `Actually, scratch what I said before — ${lowerFirst(t)}`,
};

function lowerFirst(s: string): string {
  return s.length ? s[0].toLowerCase() + s.slice(1) : s;
}

/** Deterministic, offline renderer. Same input -> same output. */
export class TemplateRenderer implements Renderer {
  render(fact: PlantedFact): string {
    return STYLE_TEMPLATES[fact.renderStyle](fact.text);
  }
}

/**
 * Scale-path renderer backed by a permitted teacher (DeepSeek/Qwen — never
 * Claude/GPT/Gemini, per the design's license rules). The `complete` callback
 * is injected so this module stays API-key-free and testable; wire it to your
 * teacher client in generate.ts when running at scale.
 */
export class TeacherRenderer implements Renderer {
  constructor(
    private complete: (prompt: string) => Promise<string>,
    private teacher: string,
  ) {}

  async render(fact: PlantedFact): Promise<string> {
    const styleHint: Record<RenderStyle, string> = {
      explicit: 'state it plainly',
      implicit: 'mention it in passing, not as the main point',
      hedged: 'express it with mild uncertainty',
      corrected: 'present it as correcting an earlier statement',
    };
    const prompt =
      `Paraphrase this fact as one natural first-person chat utterance; ${styleHint[fact.renderStyle]}. ` +
      `Do not add facts not present. Fact: "${fact.text}"`;
    const out = await this.complete(prompt);
    return out.trim();
  }

  label(): string {
    return this.teacher;
  }
}

/** Render every fact of a script into per-session dialogue blocks. */
export async function renderSessions(
  script: LifeScript,
  renderer: Renderer,
): Promise<string[]> {
  const sessions: Record<number, string[]> = {};
  for (const fact of script.facts) {
    const line = await renderer.render(fact);
    (sessions[fact.session] ??= []).push(`${script.persona.name}: ${line}`);
  }
  return Object.keys(sessions)
    .map(Number)
    .sort((a, b) => a - b)
    .map((s) => sessions[s].join('\n'));
}
