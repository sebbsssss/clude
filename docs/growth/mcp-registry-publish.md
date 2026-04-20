# Publishing Clude to the MCP Registry

Two-terminal dance. The interactive auth can only be done by the human
holding the keyboard.

## Prereqs (already done, here for reference)

- `package.json` has `"mcpName": "io.github.sebbsssss/clude"` and
  version `3.0.2`.
- `server.json` exists at repo root, name matches `mcpName`.
- npm is authenticated as an owner of `@clude/sdk`.

## Step 1 — publish the npm package

The registry will validate `mcpName` by pulling the package from npm,
so the version in `server.json` must exist on npm first.

```bash
cd ~/Projects/cluude-bot
pnpm install
pnpm run prepublishOnly        # builds dist/
npm publish --access public    # publishes @clude/sdk@3.0.2 to npm
```

Verify:

```bash
npm view @clude/sdk@3.0.2 mcpName
# should print: io.github.sebbsssss/clude
```

## Step 2 — install the publisher CLI

```bash
# macOS:
brew install mcp-publisher
# (alternative) curl install:
# curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher && sudo mv mcp-publisher /usr/local/bin/
```

## Step 3 — login (interactive, must be a human terminal)

```bash
mcp-publisher login github
```

This prints a device code + URL. Open the URL, paste the code, authorize
the app on the sebbsssss GitHub account.

## Step 4 — publish

```bash
cd ~/Projects/cluude-bot
mcp-publisher publish
```

Expected output:

```
Publishing to https://registry.modelcontextprotocol.io...
✓ Successfully published
✓ Server io.github.sebbsssss/clude version 3.0.2
```

## Step 5 — verify

```bash
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.sebbsssss/clude"
```

Should return a JSON blob with Clude's server.json contents.

## Bumping later

Each new version you want in the registry requires:

1. Bump `version` in BOTH `package.json` AND `server.json`
2. `npm publish --access public`
3. `mcp-publisher publish`

Version must increase monotonically; registry rejects downgrades.
