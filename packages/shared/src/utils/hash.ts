import murmur from 'murmurhash3js'

/**
 * MurmurHash3 32-bit hash. Produces a signed int32 to match Python `mmh3.hash()`
 * exactly so brain-side and JEPA inference service agree on concept hashes.
 */
export function murmurHash(input: string): number {
  const unsigned = murmur.x86.hash32(input)
  return unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned
}
