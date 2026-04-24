# MCP Directory Submissions — Clude

This file is the single source of truth for how Clude is listed on
every public MCP directory. Copy the blocks below directly into the
target repo PRs.

## Canonical listing

**Name:** Clude
**Tagline:** Persistent, portable memory for agents — anchored on-chain
**Package:** `@clude/sdk` (npm)
**Binary:** `clude` (via `npx @clude/sdk mcp-serve` or `npx clude mcp-serve`)
**Homepage:** https://clude.io
**Docs:** https://clude.io/docs
**Repo:** https://github.com/sebbsssss/clude
**License:** MIT
**Author:** Clude team / sebbsssss
**Category:** Memory / Knowledge
**Tags:** `memory`, `persistence`, `portability`, `solana`, `ed25519`, `embedding`

### One-paragraph description

Clude is an MCP server that gives Claude Desktop (and any MCP client)
a long-term memory layer. It stores episodic, semantic, and procedural
memories locally in SQLite with vector search, commits content hashes
to Solana for tamper-evidence, and exports the whole store to the open
`MemoryPack` format so the agent's memory is portable across
providers. Zero config — `npx @clude/sdk setup` wires it into
Claude Desktop in one step.

### Tools exposed (MCP)

- `store_memory` — persist a new memory with tags and importance
- `recall_memories` — semantic search over stored memories
- `find_clinamen` — surface unexpected connections between memories
- `get_memory_stats` — count and health of the local store

### Install

```json
{
  "mcpServers": {
    "clude-memory": {
      "command": "npx",
      "args": ["-y", "@clude/sdk", "mcp-serve"],
      "env": {
        "CORTEX_API_KEY": "clk_...",
        "CLUDE_WALLET": "<solana-pubkey>"
      }
    }
  }
}
```

## Target directories (ranked)

### 1. modelcontextprotocol/servers (official)

- **Repo:** https://github.com/modelcontextprotocol/servers
- **PR path:** Add entry to the "Community Servers" section of
  `README.md`. Sort order is alphabetical by name.
- **Submission block (paste as list item):**

```md
- [Clude](https://github.com/sebbsssss/clude) — Persistent,
  portable memory for agents. Local SQLite + vector search, anchored
  on Solana for tamper-evidence, exportable as [MemoryPack](https://github.com/sebbsssss/clude/blob/main/docs/memorypack.md).
```

- **PR title:** `Add Clude to community servers`
- **PR body:** reference this doc and link to the install quickstart.

### 2. punkpeye/awesome-mcp-servers

- **Repo:** https://github.com/punkpeye/awesome-mcp-servers
- **PR path:** Add under "Memory" category in `README.md`. Create the
  category heading if it doesn't yet exist.
- **Submission block:**

```md
- [Clude](https://github.com/sebbsssss/clude) 🔐 🦀 🪟 🍎 🐧 —
  Portable, on-chain-anchored agent memory. SQLite + vector recall,
  Solana memo commits, MemoryPack export format.
```

(Icons per the repo's legend: 🔐 = signed/verified, OS icons for
cross-platform — all Clude targets Node, so all three apply.)

### 3. wong2/awesome-mcp-servers

- **Repo:** https://github.com/wong2/awesome-mcp-servers
- **PR path:** `README.md`, "Memory" section.
- **Submission block:** same as #2 minus icons.

### 4. appcypher/awesome-mcp-servers

- **Repo:** https://github.com/appcypher/awesome-mcp-servers
- **PR path:** README, "Knowledge & Memory" subsection.
- Reuse #2 description.

### 5. MCP Market (directory site)

- **URL:** https://mcp.so/submit (and https://mcpservers.org/submit)
- **Format:** web form; paste the one-paragraph description, logo,
  install JSON block.

## Submission checklist

For each target:

- [ ] Fork the repo
- [ ] Branch named `add-clude`
- [ ] Entry placed in correct alphabetical / category position
- [ ] Local markdown lint passes (if the repo has one — check `.github/workflows`)
- [ ] PR title matches convention (`Add <name>` vs `feat: add <name>`)
- [ ] PR body links to https://clude.io and the install quickstart
- [ ] Include a short "why this matters" line: memory is the feature
      Claude Desktop users ask for most, and Clude is the only server
      that ships portability + on-chain attestation.

## After submission

- [ ] Add each PR URL to `docs/growth/mcp-directory-submissions.md`
      under a "Submitted" section with date.
- [ ] Weekly: re-check open PRs for review feedback.
- [ ] When merged: note the merge commit hash here and flip the item
      to "Listed".

## Submitted (to be filled in)

| Directory | PR | Status | Date |
|---|---|---|---|
| modelcontextprotocol/servers | TBD | pending | |
| punkpeye/awesome-mcp-servers | TBD | pending | |
| wong2/awesome-mcp-servers | TBD | pending | |
| appcypher/awesome-mcp-servers | TBD | pending | |
| mcp.so | TBD | pending | |
| mcpservers.org | TBD | pending | |
