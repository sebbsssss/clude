/**
 * VeniceLLM — implements @clude/brain LLMProvider using Venice AI (OpenAI-compatible).
 * Used for query expansion, importance scoring, and other lightweight LLM tasks.
 */

export interface VeniceConfig {
  apiKey: string;
  model?: string;  // default: llama-3.2-3b-instruct
  baseUrl?: string; // default: https://api.venice.ai/api/v1
}

interface LLMProvider {
  name: string;
  generate(opts: { system?: string; prompt: string; max_tokens?: number; temperature?: number }): Promise<string>;
}

export class VeniceLLM implements LLMProvider {
  readonly name = 'venice';
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(config: VeniceConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'llama-3.2-3b-instruct';
    this.baseUrl = config.baseUrl || 'https://api.venice.ai/api/v1';
  }

  async generate(opts: {
    system?: string; prompt: string; max_tokens?: number; temperature?: number;
  }): Promise<string> {
    const messages: Array<{ role: string; content: string }> = [];
    if (opts.system) messages.push({ role: 'system', content: opts.system });
    messages.push({ role: 'user', content: opts.prompt });

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: opts.max_tokens || 200,
        temperature: opts.temperature ?? 0.3,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Venice API error ${res.status}: ${body}`);
    }

    const json = await res.json() as any;
    return json.choices?.[0]?.message?.content || '';
  }
}
