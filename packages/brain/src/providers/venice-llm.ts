// ============================================================
// Venice AI LLM Provider (for query expansion)
// ============================================================

import type { LLMProvider } from '../types/provider.js';

export interface VeniceConfig {
  apiKey: string;
  model?: string;   // default: llama-3.2-3b (fast, cheap, private)
}

export class VeniceLLM implements LLMProvider {
  readonly name = 'venice';
  private apiKey: string;
  private model: string;

  constructor(config: VeniceConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'llama-3.2-3b';
  }

  async generate(opts: {
    system?: string;
    prompt: string;
    max_tokens?: number;
    temperature?: number;
  }): Promise<string> {
    const messages: Array<{ role: string; content: string }> = [];
    if (opts.system) messages.push({ role: 'system', content: opts.system });
    messages.push({ role: 'user', content: opts.prompt });

    const res = await fetch('https://api.venice.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: opts.max_tokens ?? 150,
        temperature: opts.temperature ?? 0.3,
      }),
    });

    if (!res.ok) throw new Error(`Venice error: ${res.status}`);

    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices?.[0]?.message?.content ?? '';
  }
}
