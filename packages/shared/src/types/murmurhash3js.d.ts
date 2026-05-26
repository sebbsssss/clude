declare module 'murmurhash3js' {
  export const x86: { hash32(s: string, seed?: number): number };
  export const x64: { hash128(s: string, seed?: number): string };
}
