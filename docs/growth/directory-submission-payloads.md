# Directory submission payloads

Copy-paste blocks for the three remaining directory submissions. All three are
web-form flows; none of them have a working API route for community servers.

## Shared fields (use wherever asked)

| Field | Value |
|---|---|
| Name | Clude |
| Short tagline | Portable agent memory anchored on Solana |
| Category | Memory / Knowledge |
| Language | TypeScript |
| License | MIT |
| Homepage | https://clude.io |
| Repository | https://github.com/sebbsssss/clude |
| Docs | https://clude.io/docs |
| Author / publisher | sebbsssss |
| Tags | memory, persistence, portability, solana, ed25519, embedding, vector-search, local-first |
| npm package | @clude/sdk |
| MCP Registry name | io.github.sebbsssss/clude |
| Logo URL | https://clude.io/favicon.png |

## Short description (≤100 chars — use for card/summary fields)

```
Portable agent memory anchored on Solana. Local SQLite + vector recall, open export.
```

## Medium description (≤280 chars — use for body / description)

```
Clude is portable agent memory for MCP clients. Local SQLite + vector recall, ed25519-signed records, optional Solana memo commits, exports to the open MemoryPack format so memory moves between vendors. Zero-config via `npx @clude/sdk setup`.
```

## Long description (full paragraph — use for detail page)

```
Clude is an MCP server that gives Claude Desktop and any MCP client a long-term
memory layer.

It stores episodic, semantic, and procedural memories locally in SQLite with
vector search, commits content hashes to Solana for tamper-evidence, and
exports the whole store to the open MemoryPack format so the agent's memory is
portable across providers.

Zero config: `npx @clude/sdk setup` wires it into Claude Desktop in one step.

What's different from other memory servers:
- Local-first by default (your memories never leave your machine unless you tell them to)
- Cryptographically signed records (ed25519, wallet-as-identity)
- Optional on-chain anchoring (Solana memo, 53-byte payload, $0 gas via Helius)
- Open export format (MemoryPack spec — any vendor can implement the reader)

Stats as of submission:
- 218,430 memories stored
- 96,543 anchored on Solana mainnet
- 238 agents registered
```

## Install JSON (for "Installation" / "Config" fields)

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

## Tools exposed (for "Capabilities" / "Tools" fields)

- `store_memory` — persist a new memory with tags and importance
- `recall_memories` — semantic search over stored memories
- `find_clinamen` — surface unexpected connections between memories
- `get_memory_stats` — count and health of the local store

---

## Target 1: mcp.so

- **URL:** https://mcp.so/submit
- **Flow:** sign in with GitHub, click "Submit Server"
- **Fields:**
  - GitHub repo: `sebbsssss/clude`
  - Name: `Clude`
  - Description: use the **medium description** above
  - Category: `Memory` (or `Knowledge` if Memory isn't listed)
  - Tags: paste the tag list
- **Paste the install JSON** into the installation section
- They typically auto-pull the README; no extra copy needed beyond the above

---

## Target 2: mcpservers.org

- **URL:** https://mcpservers.org/submit
- **Flow:** GitHub OAuth, then a single form
- **Fields:**
  - Repository URL: `https://github.com/sebbsssss/clude`
  - Short description: use the **short description** (≤100 chars)
  - Long description: use the **medium description**
  - Homepage: `https://clude.io`
  - Package name on npm: `@clude/sdk`
  - MCP command: `npx -y @clude/sdk mcp-serve`
  - Category: Memory
- If there's a logo field, paste the logo URL from the shared-fields table

---

## Target 3: glama.ai

- **URL:** https://glama.ai/mcp/servers
- **Flow:** glama.ai is a scanner, not a form — they auto-index public MCP server
  repos. Two steps to speed up indexing and get the badge:

**a)** Submit the repo URL via the "Suggest a server" link at the bottom of the
  servers page. Just paste `https://github.com/sebbsssss/clude`.

**b)** Once glama scans and assigns a slug (usually within 24h), the repo shows
  at `https://glama.ai/mcp/servers/sebbsssss/clude`. Add the score badge to
  the top of clude's README:

```md
[![Glama MCP Score](https://glama.ai/mcp/servers/sebbsssss/clude/badges/score.svg)](https://glama.ai/mcp/servers/sebbsssss/clude)
```

  Having the badge back-links from our repo, which bumps glama's recognition
  score and makes the entry rank higher in their list.

---

## Post-submission checklist

After each submission, update `mcp-directory-submissions.md` "Submitted" table
with the submission URL and date. Re-check each the following week for review
feedback or listing confirmation.
