import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { execSync } from 'child_process';

vi.mock('fs');
vi.mock('child_process');

import {
  getEmail,
  detectInstalledIDEs,
  installMcpConfig,
  validateSetup,
} from '../setup';

describe('getEmail', () => {
  beforeEach(() => {
    delete process.env.CLUDE_SETUP_EMAIL;
    vi.mocked(execSync).mockReset();
  });

  it('prefers CLUDE_SETUP_EMAIL env var', async () => {
    process.env.CLUDE_SETUP_EMAIL = 'env@example.com';
    const email = await getEmail({ skipPrompt: true });
    expect(email).toBe('env@example.com');
  });

  it('falls back to git config user.email', async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from('git@example.com\n'));
    const email = await getEmail({ skipPrompt: true });
    expect(email).toBe('git@example.com');
  });

  it('returns null when git config has no email and skipPrompt is true', async () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('no git'); });
    const email = await getEmail({ skipPrompt: true });
    expect(email).toBeNull();
  });

  it('rejects invalid email from git config', async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from('not-an-email\n'));
    const email = await getEmail({ skipPrompt: true });
    expect(email).toBeNull();
  });
});

describe('detectInstalledIDEs', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReset();
  });

  it('returns empty array when no IDE directories exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const ides = detectInstalledIDEs();
    expect(ides).toEqual([]);
  });

  it('detects Claude Code when ~/.claude exists', () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      return String(p).endsWith('.claude');
    });
    const ides = detectInstalledIDEs();
    expect(ides.find(i => i.name === 'Claude Code')).toBeDefined();
  });

  it('detects Cursor when ~/.cursor exists', () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      return String(p).endsWith('.cursor');
    });
    const ides = detectInstalledIDEs();
    expect(ides.find(i => i.name === 'Cursor')).toBeDefined();
  });
});

describe('installMcpConfig', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
    vi.mocked(fs.writeFileSync).mockReset();
    vi.mocked(fs.mkdirSync).mockReset();
  });

  it('creates new config when file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const merged = installMcpConfig(
      { name: 'Claude Code', configPath: '/test/.mcp.json' },
      { apiKey: 'clk_test', wallet: 'wallet123' },
    );

    expect(merged).toBe(false);
    expect(fs.writeFileSync).toHaveBeenCalled();
    const call = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(call[1] as string);
    expect(written.mcpServers['clude-memory']).toMatchObject({
      command: 'npx',
      args: ['clude-bot', 'mcp-serve'],
      env: { CORTEX_API_KEY: 'clk_test', CLUDE_WALLET: 'wallet123' },
    });
  });

  it('merges with existing config and preserves other servers', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: {
        'other-server': { command: 'other', args: ['x'] },
        'clude-memory': { command: 'old', env: { OLD_VAR: '1' } },
      },
    }));

    const merged = installMcpConfig(
      { name: 'Claude Code', configPath: '/test/.mcp.json' },
      { apiKey: 'clk_new', wallet: 'wallet_new' },
    );

    expect(merged).toBe(true);
    const call = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(call[1] as string);
    expect(written.mcpServers['other-server']).toEqual({
      command: 'other', args: ['x'],
    });
    expect(written.mcpServers['clude-memory'].env.CORTEX_API_KEY).toBe('clk_new');
  });

  it('omits empty env vars', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    installMcpConfig(
      { name: 'Cursor', configPath: '/test/mcp.json' },
      { apiKey: '', wallet: '' },
    );

    const call = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(call[1] as string);
    expect(written.mcpServers['clude-memory'].env).toEqual({});
  });
});
