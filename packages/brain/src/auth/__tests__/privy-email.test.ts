import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Privy SDK before importing the module
const mockGetByEmailAddress = vi.fn();
const mockCreate = vi.fn();

vi.mock('@privy-io/node', () => ({
  PrivyClient: vi.fn(function (this: any) {
    this.users = () => ({
      getByEmailAddress: mockGetByEmailAddress,
      create: mockCreate,
    });
  } as any),
}));

// Mock config so getPrivyClient() builds a client (no importActual — shared/config has no dist)
vi.mock('@clude/shared/config', () => ({
  config: {
    privy: {
      appId: 'test-app-id',
      appSecret: 'test-app-secret',
      jwksUrl: 'https://test.privy.io/jwks',
    },
  },
}));

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { findOrCreatePrivyUserByEmail } from '../privy-wallet-resolver';

describe('findOrCreatePrivyUserByEmail', () => {
  beforeEach(() => {
    mockGetByEmailAddress.mockReset();
    mockCreate.mockReset();
  });

  it('returns existing DID when email is already registered', async () => {
    mockGetByEmailAddress.mockResolvedValue({ id: 'did:privy:existing123' });

    const did = await findOrCreatePrivyUserByEmail('alice@example.com');

    expect(did).toBe('did:privy:existing123');
    expect(mockGetByEmailAddress).toHaveBeenCalledWith({ address: 'alice@example.com' });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates a new user when email is not found (404)', async () => {
    const notFoundErr: any = new Error('not found');
    notFoundErr.status = 404;
    mockGetByEmailAddress.mockRejectedValue(notFoundErr);
    mockCreate.mockResolvedValue({ id: 'did:privy:new456' });

    const did = await findOrCreatePrivyUserByEmail('bob@example.com');

    expect(did).toBe('did:privy:new456');
    expect(mockCreate).toHaveBeenCalledWith({
      linked_accounts: [{ type: 'email', address: 'bob@example.com' }],
    });
  });

  it('rethrows non-404 errors from getByEmailAddress', async () => {
    const serverErr: any = new Error('Privy API down');
    serverErr.status = 500;
    mockGetByEmailAddress.mockRejectedValue(serverErr);

    await expect(findOrCreatePrivyUserByEmail('carol@example.com'))
      .rejects.toThrow('Privy API down');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('throws when create returns no DID', async () => {
    const notFoundErr: any = new Error('not found');
    notFoundErr.status = 404;
    mockGetByEmailAddress.mockRejectedValue(notFoundErr);
    mockCreate.mockResolvedValue({});

    await expect(findOrCreatePrivyUserByEmail('dave@example.com'))
      .rejects.toThrow('Privy user creation returned no DID');
  });
});
