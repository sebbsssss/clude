import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Lazy X client init — keyless processes (GCP validation instances, SDK,
 * site-only) must be able to import this module without X credentials.
 * TwitterApi throws 'Invalid consumer tokens' at construction when keys are
 * empty, so construction must happen on first use, never at module load.
 */

const logSpies = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../logger', () => ({ createChildLogger: () => logSpies }));

// Mutable so individual tests can flip between keyless and credentialed boots.
const mockX = vi.hoisted(() => ({
  apiKey: '',
  apiSecret: '',
  accessToken: '',
  accessSecret: '',
  botUserId: '',
  creatorUserId: '',
}));
vi.mock('../../config', () => ({ config: { x: mockX } }));

// Faithful to twitter-api-v2 v1.29.0: buildOAuth() throws 'Invalid consumer
// tokens' when appKey/appSecret are falsy — the exact crash seen on Cloud Run.
const twitterCtorMock = vi.hoisted(() => vi.fn());
vi.mock('twitter-api-v2', () => ({
  TwitterApi: class {
    readWrite = { v2: {} };
    constructor(tokens: { appKey?: string; appSecret?: string }) {
      if (!tokens?.appKey || !tokens?.appSecret) {
        throw new Error('Invalid consumer tokens');
      }
      twitterCtorMock(tokens);
    }
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockX.apiKey = '';
  mockX.apiSecret = '';
  mockX.accessToken = '';
  mockX.accessSecret = '';
});

describe('x-client lazy initialization', () => {
  it('imports cleanly when no X credentials are set (keyless boot)', async () => {
    await expect(import('../x-client')).resolves.toBeDefined();
  });

  it('getXClient() returns null without credentials and warns exactly once', async () => {
    const { getXClient } = await import('../x-client');

    expect(getXClient()).toBeNull();
    expect(getXClient()).toBeNull();

    expect(logSpies.warn).toHaveBeenCalledTimes(1);
    expect(twitterCtorMock).not.toHaveBeenCalled();
  });

  it('throws a descriptive error when an X action is attempted without credentials', async () => {
    const { postTweet } = await import('../x-client');

    await expect(postTweet('hello')).rejects.toThrow(/X_API_KEY/);
  });

  it('memoizes the client — constructs TwitterApi once when credentials are present', async () => {
    mockX.apiKey = 'k';
    mockX.apiSecret = 's';
    mockX.accessToken = 't';
    mockX.accessSecret = 'ts';

    const { getXClient } = await import('../x-client');

    const a = getXClient();
    const b = getXClient();

    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(twitterCtorMock).toHaveBeenCalledTimes(1);
    expect(logSpies.warn).not.toHaveBeenCalled();
  });
});
