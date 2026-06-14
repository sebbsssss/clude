// ============================================================
// Teacher client for the scale path (corpus rendering at 100K+).
//
// PERMITTED teachers only: DeepSeek (MIT), Qwen3 (Apache, self-hosted), Kimi K2,
// Mistral open models. NEVER Claude/GPT/Gemini — their terms forbid training a
// competing model on their outputs (see the design doc, Section 6.2).
//
// This is a thin OpenAI-compatible completion fn you pass to TeacherRenderer.
// Default points at DeepSeek; set TEACHER_BASE_URL/TEACHER_MODEL to self-host Qwen.
// ============================================================

export interface TeacherConfig {
  apiKey: string;
  baseUrl?: string; // default DeepSeek
  model?: string;
}

const BANNED = ['gpt', 'openai', 'claude', 'anthropic', 'gemini', 'google'];

export function makeTeacher(cfg: TeacherConfig): { complete: (prompt: string) => Promise<string>; model: string } {
  const baseUrl = cfg.baseUrl ?? 'https://api.deepseek.com/v1';
  const model = cfg.model ?? 'deepseek-chat';

  // Guardrail: refuse to distill from a license-incompatible teacher.
  if (BANNED.some((b) => model.toLowerCase().includes(b) || baseUrl.toLowerCase().includes(b))) {
    throw new Error(
      `Refusing teacher "${model}" @ ${baseUrl}: Claude/GPT/Gemini outputs may not train a competing model. ` +
        `Use DeepSeek/Qwen/Kimi/Mistral (see design Section 6.2).`,
    );
  }

  const complete = async (prompt: string): Promise<string> => {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 256,
      }),
    });
    if (!res.ok) throw new Error(`Teacher API ${res.status}: ${await res.text().catch(() => '')}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const out = data.choices?.[0]?.message?.content;
    if (!out) throw new Error('Teacher returned empty content');
    return out;
  };

  return { complete, model };
}
