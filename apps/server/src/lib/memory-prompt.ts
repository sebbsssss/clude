/**
 * Memory context builder for the chat system prompt — the read-side hallucination defense.
 *
 * Extracted from chat.routes.ts and upgraded per the HaluMem findings (PR #257) and the
 * grounding/abstention literature:
 *   1. GROUNDING RULES — claims about the user must be grounded in the <memories> block;
 *      unsupported specifics get "I don't remember" instead of a guess. Prompt-side
 *      grounding + selective abstention measurably cuts hallucination (30-50% across
 *      2025 studies) at near-zero coverage cost for general knowledge (rules are scoped
 *      to user-specific claims only).
 *   2. TIMESTAMPS + CHRONOLOGICAL TIMELINE + TEMPORAL-SCOPED TRUTH — every line is dated
 *      and each section is ordered oldest→newest, so conflicting facts read as a timeline
 *      rather than a flat bag. The resolution rule is scoped to the question's tense: a
 *      present-tense question takes the most-recent value (latest-wins); an "as of <past
 *      date>" question takes the value that was in effect at that time. Blunt latest-wins
 *      was the original fix, but it mis-answers as-of-past-date questions — the dominant
 *      remaining hallucination class (wrong-date / superseded-fact; HaluMem Dynamic-Update
 *      ~17%). The lever here is disambiguation, not abstention (a stricter abstain pass
 *      was measured net-negative — it prunes correct answers without catching these).
 *   3. CONTENT SNIPPETS — the model can only ground in text it can see. Summaries alone
 *      force it to improvise details; a bounded slice of the underlying content gives it
 *      quotable facts (the same lesson LongMemEval taught: full content > truncated summary).
 *   4. HONEST EMPTY-RECALL — the previous copy ("You still know them — offer to help")
 *      invited the model to perform familiarity it had no grounding for. Replaced with an
 *      explicit no-invention instruction.
 */

export interface PromptMemory {
  memory_type?: string;
  summary?: string;
  content?: string;
  created_at?: string;
}

/** Max characters of memory content rendered into a prompt line. */
const CONTENT_SNIPPET_MAX = 600;

/** Render one memory as a dated, groundable prompt line. */
export function renderMemoryLine(m: PromptMemory): string {
  const date = m.created_at ? new Date(m.created_at).toISOString().slice(0, 10) : '';
  const stamp = date ? `[${date}] ` : '';
  const summary = (m.summary || '').trim();
  const content = (m.content || '').trim();

  let body: string;
  if (!content || content === summary) {
    body = summary || content;
  } else if (content.length <= CONTENT_SNIPPET_MAX) {
    body = summary ? `${summary} — ${content}` : content;
  } else {
    const slice = content.slice(0, CONTENT_SNIPPET_MAX);
    body = summary ? `${summary} — ${slice}…` : `${slice}…`;
  }
  return `- ${stamp}${body}`;
}

const GROUNDING_RULES = `
<memory_rules>
- Ground every claim about this user — their facts, preferences, history, dates, numbers, names — in the memories above. If a specific detail is not in the memories, say you don't remember it rather than guessing.
- Each memory is dated. When memories about the same thing disagree, read them as a timeline, not a contradiction — each was true as of its date. For a question about now (no date given), use the value from the most recent memory and treat older ones as superseded. For a question about a specific past time ("as of …", "back in March", "when I …"), use the value that was in effect at that time, not the latest one. Never blend conflicting values into a single answer.
- Never invent memories, past conversations, or details that are not written above. "I don't have that in memory" is always better than a confident guess.
- These rules apply to claims about the user and your shared history. General knowledge is unaffected — answer those questions normally.
</memory_rules>`;

export function buildSystemPrompt(
  memories: PromptMemory[],
  opts?: { totalMemoryCount?: number; isGreeting?: boolean },
): string {
  const currentDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  // Order each section oldest→newest so conflicting facts read as a dated timeline
  // (header note 2). filter() returns fresh arrays, so sorting them never mutates the
  // caller's `memories`. Undated memories sink to the end of their section.
  const byDateAsc = (a: PromptMemory, b: PromptMemory): number => {
    const ta = a.created_at ? Date.parse(a.created_at) : NaN;
    const tb = b.created_at ? Date.parse(b.created_at) : NaN;
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return ta - tb;
  };
  const semantic = memories.filter(m => m.memory_type === 'semantic').sort(byDateAsc);
  const procedural = memories.filter(m => m.memory_type === 'procedural').sort(byDateAsc);
  const selfModel = memories.filter(m => m.memory_type === 'self_model').sort(byDateAsc);
  const episodic = memories.filter(m => m.memory_type === 'episodic' || m.memory_type === 'introspective').sort(byDateAsc);

  const sections: string[] = [];
  if (semantic.length > 0) {
    sections.push('<knowledge>\n' + semantic.map(renderMemoryLine).join('\n') + '\n</knowledge>');
  }
  if (procedural.length > 0) {
    sections.push('<behaviors>\n' + procedural.map(renderMemoryLine).join('\n') + '\n</behaviors>');
  }
  if (selfModel.length > 0) {
    sections.push('<identity>\n' + selfModel.map(renderMemoryLine).join('\n') + '\n</identity>');
  }
  if (episodic.length > 0) {
    sections.push('<recent>\n' + episodic.map(renderMemoryLine).join('\n') + '\n</recent>');
  }

  let memoryContext: string;
  if (memories.length > 0) {
    memoryContext = `\n\nYou have recalled ${memories.length} relevant memories for this user${opts?.totalMemoryCount ? ` (out of ${opts.totalMemoryCount} total stored)` : ''}.\n\n<memories count="${memories.length}">\n${sections.join('\n')}\n</memories>\n${GROUNDING_RULES}`;
  } else if (opts?.totalMemoryCount && opts.totalMemoryCount > 0) {
    memoryContext = `\n\nThis user has ${opts.totalMemoryCount} stored memories, but none matched this query. Do not invent or guess past conversations, facts, or details about them — if they ask about something specific you don't have, say you don't remember it. You can still help with general knowledge, and you will remember everything new from this conversation onward.`;
  } else {
    memoryContext = `\n\nThis is a new user with no stored memories yet. Welcome them and let them know you'll remember everything from your conversations going forward. Do not pretend to already know things about them.`;
  }

  if (opts?.isGreeting) {
    return `You are Clude — an AI with persistent, long-term memory. You remember everything users tell you across conversations.
Today's date is ${currentDate}.

This user just signed in. Greet them warmly and personally. If you have their memories, give a brief recap of what you remember about them and what they were last working on. Be conversational, not robotic. Don't list memories mechanically — weave them into a natural greeting. Keep it to 2-3 sentences.

Never mention infrastructure providers or technical details about how you work. You ARE the memory system — you don't "query" it, you simply remember.${memoryContext}`;
  }

  return `You are Clude — an AI with persistent, long-term memory. You remember everything users tell you across conversations.
Today's date is ${currentDate}.

Use your memories naturally in conversation. Don't say "according to my records" or "I recall from my database" — just reference what you know like a person would. If a user asks about their memories, you can describe what you remember.

Never mention infrastructure providers or technical details about how you work. Never tell users to check any external service. You ARE the memory system.${memoryContext}`;
}
