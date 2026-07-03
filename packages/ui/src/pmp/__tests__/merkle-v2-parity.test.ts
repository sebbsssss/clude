import { describe, it, expect } from 'vitest';
import { computeMerkleRootV2 } from '../decrypt-pmp';

/**
 * Memory 3.0 B2.1: the browser merkle-v2 twin must match the canonical Node
 * implementation (@clude/tokenization pack-merkle.ts) BYTE-FOR-BYTE.
 *
 * Parity is pinned via GOLDEN VECTORS: the roots below were produced by
 * buildPackTreeV2 (the canonical source) over sha256('a'..'e') leaves. The
 * tokenization suite exercises the same construction, so if either side
 * drifts (prefixes, promotion, hex handling) exactly one of the two suites
 * breaks against these constants. No cross-package import: the ui package
 * stays browser-clean (no node types in its tsconfig).
 *
 * Regenerate (only if the v2 SPEC itself changes, which it must not):
 *   cd packages/tokenization && npx tsx -e "import {buildPackTreeV2} from
 *   './src/pack-merkle'; ..." — see git history of this file.
 */

// sha256('a')..sha256('e')
const LEAVES = [
  'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
  '3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d',
  '2e7d2c03a9507ae265ecf5b5356885a53393a2029d241394997265a1a25aefc6',
  '18ac3e7343f016890c510e93f935261169d9e3f565436429830faf0934f4f8e4',
  '3f79bb7b435b05321651daefd374cdc681dc06faa65e374e38337b88ca046dea',
];

const GOLDEN_ROOTS: Record<number, string> = {
  1: 'a23bd5b06da9048238a65b3f1d9d0b9e15fae3dde262688e6489aa4c763d1820',
  2: 'ad5ca6cddc0b27c6a83e332bf28011769236e6c6a1f786ebf7b5267b37a5bd22',
  3: 'cac3d448d4e20a2ad5eae1f500e63c2a7f9217cd14572ba7fd22e26dc1ec2648',
  4: '3baac34fdbf4f2297a37c0613822d0c48efdcd6602ca7a4f48ceb31339ffb3d5',
  5: '4dc1abc938a0141a3c7cd1fed88948c35c4452e7e8aff9b1503eb5100a2c77b3',
};

// buildPackTreeV2([a,b,c,c]).root — must NOT equal the 3-leaf root (the forgery v2 closes).
const DUP_TAIL_ROOT_4 = '9d33f58b8278558c024289455085c05d2037eedf3fb1938c8e8c49a10603f687';

describe('browser merkle-v2 twin parity (golden vectors from the Node canonical)', () => {
  for (const n of [1, 2, 3, 4, 5]) {
    it(`matches the canonical v2 root for ${n} leaves`, async () => {
      expect(await computeMerkleRootV2(LEAVES.slice(0, n))).toBe(GOLDEN_ROOTS[n]);
    });
  }

  it('closes the duplicate-tail forgery in the browser too', async () => {
    const dup = await computeMerkleRootV2([LEAVES[0]!, LEAVES[1]!, LEAVES[2]!, LEAVES[2]!]);
    expect(dup).toBe(DUP_TAIL_ROOT_4); // matches the canonical duplicated-tail root...
    expect(dup).not.toBe(GOLDEN_ROOTS[3]); // ...and differs from the 3-leaf root
  });

  it('is domain-separated: a single-leaf root is not the raw leaf', async () => {
    expect(await computeMerkleRootV2([LEAVES[0]!])).not.toBe(LEAVES[0]);
  });
});
