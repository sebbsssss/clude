/**
 * HTTP transport for hosted Cortex mode.
 * Wraps fetch calls with Bearer auth and JSON serialization.
 */
export class HttpTransport {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: { apiKey: string; baseUrl?: string }) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || 'https://cluude.ai').replace(/\/$/, '');
  }

  async post<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`Cortex API error (${res.status}): ${(error as any).error || res.statusText}`);
    }

    return res.json() as Promise<T>;
  }

  async get<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) url.searchParams.set(k, v);
      }
    }

    const res = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`Cortex API error (${res.status}): ${(error as any).error || res.statusText}`);
    }

    return res.json() as Promise<T>;
  }
}
