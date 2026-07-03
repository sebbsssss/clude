import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Slice 3a — the Vertex AI embedding provider (gemini-embedding-001).
 *
 * Vertex breaks the OpenAI-shaped PROVIDERS contract three ways, all covered here:
 *   1. URL carries project + location + model:  {loc}-aiplatform.googleapis.com/.../{model}:predict
 *   2. Body:      { instances:[{content}], parameters:{ outputDimensionality } }
 *   3. Response:  { predictions:[{ embeddings:{ values:number[] } }] }
 * Auth is a short-lived GCP OAuth token (VERTEX_ACCESS_TOKEN override here; the
 * Cloud Run metadata-server path is tested separately via _fetchMetadataToken).
 */

vi.hoisted(() => {
  process.env.SITE_ONLY = 'true';
  process.env.VERTEX_PROJECT = 'clude-query-sol-data';
  process.env.VERTEX_LOCATION = 'us-central1';
  process.env.VERTEX_EMBEDDING_MODEL = 'gemini-embedding-001';
  process.env.VERTEX_ACCESS_TOKEN = 'test-token'; // skip the metadata server in unit tests
});

const logSpies = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('../logger', () => ({ createChildLogger: () => logSpies }));

import {
  generateEmbeddingForSpace,
  generateQueryEmbeddingForSpace,
  generateVertexEmbeddings,
  _fetchMetadataToken,
  _resetVertexAuthCache,
} from '../embeddings';

const fetchMock = vi.fn();

function ok(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(''),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetVertexAuthCache();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generateEmbeddingForSpace("vertex")', () => {
  it('calls the Vertex :predict endpoint with the right URL, auth, and body shape', async () => {
    fetchMock.mockReturnValueOnce(ok({ predictions: [{ embeddings: { values: [0.1, 0.2, 0.3] } }] }));

    const vec = await generateEmbeddingForSpace('vertex', 'hello world');

    expect(vec).toEqual([0.1, 0.2, 0.3]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/clude-query-sol-data/locations/us-central1/publishers/google/models/gemini-embedding-001:predict',
    );
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
    expect(JSON.parse(init.body)).toEqual({
      instances: [{ content: 'hello world' }],
      parameters: { outputDimensionality: 1024 },
    });
  });

  it('returns null (not a throw) on a non-200 Vertex response', async () => {
    fetchMock.mockReturnValueOnce(
      Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({}), text: () => Promise.resolve('quota') }),
    );
    const vec = await generateEmbeddingForSpace('vertex', 'x');
    expect(vec).toBeNull();
  });

  it('delegates voyage space to the existing path (no Vertex call)', async () => {
    // Voyage isn't configured under SITE_ONLY, so this resolves to null without hitting Vertex.
    const vec = await generateEmbeddingForSpace('voyage', 'x');
    expect(vec).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('generateQueryEmbeddingForSpace', () => {
  it('routes vertex queries to Vertex', async () => {
    fetchMock.mockReturnValueOnce(ok({ predictions: [{ embeddings: { values: [9, 9] } }] }));
    const vec = await generateQueryEmbeddingForSpace('vertex', 'q');
    expect(vec).toEqual([9, 9]);
  });

  it('routes voyage queries to the existing query path (no Vertex call)', async () => {
    const vec = await generateQueryEmbeddingForSpace('voyage', 'q');
    expect(vec).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('generateVertexEmbeddings (batch)', () => {
  it('maps predictions positionally to the input texts', async () => {
    fetchMock.mockReturnValueOnce(
      ok({
        predictions: [
          { embeddings: { values: [1, 1] } },
          { embeddings: { values: [2, 2] } },
        ],
      }),
    );

    const out = await generateVertexEmbeddings(['a', 'b']);

    expect(out).toEqual([[1, 1], [2, 2]]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.instances).toEqual([{ content: 'a' }, { content: 'b' }]);
  });

  it('honors an explicit output dimensionality', async () => {
    fetchMock.mockReturnValueOnce(ok({ predictions: [{ embeddings: { values: [0] } }] }));
    await generateVertexEmbeddings(['a'], 768);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.parameters.outputDimensionality).toBe(768);
  });
});

describe('_fetchMetadataToken (Cloud Run / GCE service account, SDK-free)', () => {
  it('reads the access token from the GCE metadata server', async () => {
    fetchMock.mockReturnValueOnce(ok({ access_token: 'meta-tok', expires_in: 3599, token_type: 'Bearer' }));

    const tok = await _fetchMetadataToken();

    expect(tok).toEqual({ token: 'meta-tok', expiresInSec: 3599 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('metadata.google.internal');
    expect(url).toContain('/service-accounts/default/token');
    expect((init.headers as Record<string, string>)['Metadata-Flavor']).toBe('Google');
  });
});
