# @clude/mcp

Persistent memory for any AI agent via [MCP](https://modelcontextprotocol.io).

Works with Claude Desktop, Claude Code, Cursor, Windsurf, and any MCP-compatible client.

## Setup

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "clude": {
      "command": "npx",
      "args": ["tsx", "/path/to/clude/packages/mcp/src/index.ts"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add clude npx tsx /path/to/clude/packages/mcp/src/index.ts
```

### Cursor / Windsurf

Add to MCP settings with command: `npx tsx /path/to/clude/packages/mcp/src/index.ts`

## Modes

### Local (default, zero config)

Stores memories in `~/.clude/memories.db` using SQLite. No API keys needed.

Requires `better-sqlite3`:
```bash
npm install -g better-sqlite3
```

### Cloud (Supabase + Voyage AI)

Set env vars:
```json
{
  "mcpServers": {
    "clude": {
      "command": "npx",
      "args": ["tsx", "/path/to/clude/packages/mcp/src/index.ts"],
      "env": {
        "CLUDE_MODE": "cloud",
        "CLUDE_SUPABASE_URL": "https://your-project.supabase.co",
        "CLUDE_SUPABASE_KEY": "your-service-key",
        "CLUDE_VOYAGE_KEY": "your-voyage-key",
        "CLUDE_OWNER_WALLET": "your-wallet-address"
      }
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `remember` | Store a memory (content, summary, type, tags, importance) |
| `recall` | Search memories by query, type, or tags |
| `forget` | Delete a memory by ID |
| `memory_stats` | Get total count and breakdown by type |

## Memory Types

- **episodic** - events, conversations, interactions
- **semantic** - facts, knowledge, beliefs
- **procedural** - how-to, workflows, patterns
- **self_model** - agent's self-awareness
