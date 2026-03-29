import { createChildLogger } from './logger';

const log = createChildLogger('web-search');

const TAVILY_API_URL = 'https://api.tavily.com';

export interface WebSearchResult {
  content: string;
  citations: string[];
}

let _apiKey: string | null = null;

export function initWebSearch(apiKey: string): void {
  _apiKey = apiKey;
  log.info('Web search (Tavily) initialized');
}

export function isWebSearchEnabled(): boolean {
  return !!_apiKey;
}

/**
 * Search the web using Tavily and return a synthesized answer with citations.
 * Tavily is purpose-built for LLM web search — returns clean, relevant results.
 */
export async function webSearch(opts: {
  query: string;
  maxResults?: number;
}): Promise<WebSearchResult> {
  if (!_apiKey) {
    throw new Error('Web search not initialized — missing TAVILY_API_KEY');
  }

  try {
    const response = await fetch(`${TAVILY_API_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: _apiKey,
        query: opts.query,
        max_results: opts.maxResults || 5,
        include_answer: true,
        search_depth: 'basic',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Tavily API error: ${response.status} ${errorText}`);
    }

    const data = await response.json() as {
      answer?: string;
      results?: Array<{ url: string; title: string; content: string }>;
    };

    const citations = (data.results || []).map(r => r.url);
    const content = data.answer || (data.results || []).map(r => r.content).join('\n\n');

    log.debug({ query: opts.query, resultCount: data.results?.length }, 'Web search completed');

    return { content, citations };
  } catch (err) {
    log.error({ err, query: opts.query }, 'Web search failed');
    throw err;
  }
}
