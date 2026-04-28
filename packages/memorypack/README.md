# @clude/memorypack

Reference reader/writer for the **MemoryPack** spec — an open, signed, chain-anchorable file format for portable AI agent memory.

## Why this exists

When you switch AI providers, you don't just lose a model. You lose the agent — because every vendor stores memory in a proprietary shape, behind a proprietary API, on a proprietary cluster.

MemoryPack is a vendor-neutral file format that fixes that. JSONL records, ed25519 signatures, optional on-chain anchors. Any runtime that implements the reader can ingest a pack produced by any other runtime.

This package is the **standalone reference implementation** — `npm install @clude/memorypack` and you can produce, read, sign, and verify packs without installing the rest of Clude.

## Install

```bash
npm install @clude/memorypack
# or
pnpm add @clude/memorypack
```

For chain anchor verification (Solana memo proofs), also install the optional peer dep:

```bash
npm install @solana/web3.js
```

## CLI verifier

The package ships a tiny standalone verifier — the auditor experience. Install one ~30 KB package, point it at a pack, get a clean OK / REJECTED with exit code 0 / 1. No Clude SDK, no Supabase, no API keys.

```bash
# Verify offline (signatures + blobs + revocations)
npx @clude/memorypack verify ./my-pack

# Also verify on-chain anchors against a Solana RPC
npx @clude/memorypack verify ./my-pack \
  --verify-chain --strict-chain \
  --rpc-url https://api.mainnet-beta.solana.com

# Decrypt a pack-level-encrypted pack
npx @clude/memorypack verify ./my-pack \
  --decrypt-key $(cat ~/.keys/pack-key.b64)
```

Exit codes: `0` if every check passed, `1` otherwise. Suitable for cron, CI, and regulator workflows.

Run `npx @clude/memorypack --help` for the full flag list.

## Usage

### Write a pack

```ts
import { writeMemoryPack } from '@clude/memorypack';
import nacl from 'tweetnacl';

const keypair = nacl.sign.keyPair();

writeMemoryPack('./my-pack', records, {
  producer: {
    name: 'my-agent',
    version: '1.0',
    public_key: bs58Encode(keypair.publicKey),
  },
  record_schema: 'my-schema-v1',
  secretKey: keypair.secretKey,
  // v0.2 features
  format: 'tarball',                 // emits .tar.zst (or 'directory')
  encryption: { key: aesKey32 },     // optional pack-level encryption
  blobs: new Map([[hash, { data }]]),// optional binary attachments
});
```

### Read + verify

```ts
import { readMemoryPack } from '@clude/memorypack';

const result = readMemoryPack('./my-pack');         // also accepts .tar.zst
console.log(`${result.verifiedRecords.size} verified records`);
console.log(`${result.warnings.length} warnings`);
```

### Verify on-chain anchors

```ts
import { verifyChainAnchors } from '@clude/memorypack';

const { verified, warnings } = await verifyChainAnchors(result.anchors, {
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  expectedSigner: 'CnTSRC...',
});
```

### Stream large packs

`readMemoryPack` loads everything into memory — fine for the typical case, painful past ~100MB. Use `streamMemoryPack` to iterate records line-by-line with bounded memory:

```ts
import { streamMemoryPack } from '@clude/memorypack';

const { manifest, records, anchors, warnings } = await streamMemoryPack(path, {
  // Optional — same options as readMemoryPack
  decryptionKey: aesKey32,
  strictSignatures: true,
});

console.log(`pack created ${manifest.created_at}, ${manifest.record_count} records`);

for await (const { record, hash, verified } of records) {
  // Process one record at a time. Hash + signature already verified.
  await indexer.add(record);
}

// `warnings` is populated as the iterator runs. Read after iteration completes.
console.log(warnings);
```

Signature semantics match the eager reader: when `signatures.jsonl` is present, every record must verify, and the iterator throws on the first mismatch. Encrypted records decrypt on the fly when `decryptionKey` is supplied. Tarballs (`.tar.zst`) auto-extract before streaming.

### Revoke records (soft-delete)

Records and their signatures are immutable — you cannot delete a record without breaking the audit trail. For GDPR right-to-erasure, PII leaks, and corrections, MemoryPack supports **signed revocations**: a separate signed assertion that says "as of this date, the producer no longer attests to this record."

```ts
import { appendRevocations, readMemoryPack } from '@clude/memorypack';

appendRevocations(packDir, [
  { record_hash: 'sha256:9f6c...', reason: 'user-erasure' },
], {
  secretKey: producerSecretKey,
  publicKey: producerPublicKey,
});

const result = readMemoryPack(packDir);
result.revokedRecordHashes.has('sha256:9f6c...'); // → true
```

Revocations are append-only and forward-only — once revoked, always revoked. The signed payload is `revoke:v1:<record_hash>:<revoked_at>`, signed by the same producer keypair that signed the record. Readers reject revocations signed by other keys or with broken signatures (warning, not throw — one bad entry shouldn't poison the trail).

Records remain in `result.records` after revocation; apps decide whether to surface as `[redacted]`, omit, or display with a flag.

## What's in v0.2

| Feature | API |
|---|---|
| Directory packs (manifest + records + sigs + anchors) | `writeMemoryPack`, `readMemoryPack` |
| `.tar.zst` packing + auto-extract on read | `format: 'tarball'` |
| Binary attachments via `blobs/sha256/` | `WriterOptions.blobs`, `result.verifiedBlobs` |
| Pack-level encryption (xsalsa20-poly1305) | `WriterOptions.encryption.{key, scope}` |
| ed25519 record signing (mandatory when sigs present) | `WriterOptions.secretKey` |
| Chain anchor verification (Solana SPL Memo) | `verifyChainAnchors()` |
| Schema-evolution fallback (minimal-shape readers) | `result.minimalRecords` |
| **Streaming reader for large packs** | `streamMemoryPack` (async iterator) |
| **Signed revocations (soft-delete)** | `appendRevocations`, `result.revokedRecordHashes` |
| **Standalone CLI verifier** | `npx @clude/memorypack verify <pack>` |
| Reference test vectors (deterministic fixture) | `src/__tests__/fixtures.ts` |

Full spec: [docs/memorypack.md](https://github.com/sebbsssss/clude/blob/main/docs/memorypack.md).

## Why not `@clude/brain`?

`@clude/brain` is the full Clude SDK — agent runtime, memory engine, dream cycle, ~5MB of TypeScript. Most third-party vendors implementing MemoryPack don't want any of that.

`@clude/memorypack` is the file format only. Two runtime deps (`tweetnacl`, `bs58`), one optional peer dep (`@solana/web3.js` for chain anchor verification), zero Clude code. ~50KB unpacked.

## Reference test vectors

A canonical fixture in `src/__tests__/fixtures.ts` exposes:

- A deterministic 32-byte ed25519 seed → known keypair
- Two canonical records with stable byte layout
- Fixed `created_at` injected via `WriterOptions.clock`
- `EXPECTED_RECORD_HASHES` — per-record SHA-256s of the serialized JSONL lines

External implementers can reproduce the same hashes from the same inputs and use them as a contract test against the spec.

## License

MIT.

## Roadmap

Post-v0.2 (tracked in the [main repo](https://github.com/sebbsssss/clude)):

- Production IPFS / Arweave content anchoring
- Multi-chain anchors (Ethereum L2, Bitcoin OP_RETURN)
- True streaming through tar (today the reader extracts to a temp dir first)
- Tarball-aware `appendRevocations` (today only directory packs)
- Chain-anchored revocations (so revocation timestamps can't be backdated)
