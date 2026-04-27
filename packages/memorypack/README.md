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
- Streaming reader for packs > 100MB
- Revocations format
- `clude verify` CLI distributed alongside this package
