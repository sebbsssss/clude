import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDelete = vi.fn();
const mockUsers = vi.fn(() => ({ delete: mockDelete }));
const PrivyClientCtor = vi.fn(function (this: any, _opts: any) {
  this.users = mockUsers;
});

class FakeNotFoundError extends Error {
  status = 404;
}

vi.mock('@privy-io/node', () => ({
  PrivyClient: PrivyClientCtor,
  NotFoundError: FakeNotFoundError,
}));

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockConfig = {
  privy: {
    appId: 'test-app-id',
    appSecret: 'test-app-secret',
    jwksUrl: 'https://test.privy.io/jwks',
  },
};
vi.mock('@clude/shared/config', () => ({
  config: mockConfig,
}));

describe('privy-admin-client', () => {
  beforeEach(() => {
    vi.resetModules();
    PrivyClientCtor.mockClear();
    mockUsers.mockClear();
    mockDelete.mockReset();
    mockConfig.privy.appId = 'test-app-id';
    mockConfig.privy.appSecret = 'test-app-secret';
  });

  it('lazily constructs a single PrivyClient across calls', async () => {
    mockDelete.mockResolvedValue(undefined);
    const { deletePrivyUser } = await import('../privy-admin-client');

    await deletePrivyUser('did:privy:abc');
    await deletePrivyUser('did:privy:xyz');

    expect(PrivyClientCtor).toHaveBeenCalledTimes(1);
    expect(PrivyClientCtor).toHaveBeenCalledWith({
      appId: 'test-app-id',
      appSecret: 'test-app-secret',
    });
  });

  it('calls client.users().delete with the user id on happy path', async () => {
    mockDelete.mockResolvedValue(undefined);
    const { deletePrivyUser } = await import('../privy-admin-client');

    await deletePrivyUser('did:privy:abc');

    expect(mockDelete).toHaveBeenCalledWith('did:privy:abc');
  });

  it('treats NotFoundError as success (idempotent delete)', async () => {
    mockDelete.mockRejectedValue(new FakeNotFoundError('user gone'));
    const { deletePrivyUser } = await import('../privy-admin-client');

    await expect(deletePrivyUser('did:privy:gone')).resolves.toBeUndefined();
  });

  it('rethrows non-404 SDK errors', async () => {
    mockDelete.mockRejectedValue(new Error('500 internal'));
    const { deletePrivyUser } = await import('../privy-admin-client');

    await expect(deletePrivyUser('did:privy:boom')).rejects.toThrow('500 internal');
  });

  it('throws a clear error when PRIVY_APP_SECRET is unset', async () => {
    mockConfig.privy.appSecret = '';
    const { deletePrivyUser } = await import('../privy-admin-client');

    await expect(deletePrivyUser('did:privy:abc')).rejects.toThrow(
      /PRIVY_APP_SECRET/,
    );
    expect(PrivyClientCtor).not.toHaveBeenCalled();
  });

  it('throws when PRIVY_APP_ID is unset', async () => {
    mockConfig.privy.appId = '';
    const { deletePrivyUser } = await import('../privy-admin-client');

    await expect(deletePrivyUser('did:privy:abc')).rejects.toThrow(
      /PRIVY_APP_ID/,
    );
    expect(PrivyClientCtor).not.toHaveBeenCalled();
  });
});
