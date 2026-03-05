/// <reference lib="es2022" />

declare module 'crypto' {
  export function randomBytes(size: number): Buffer;
  export function createHash(algorithm: string): Hash;
  export function createHmac(algorithm: string, key: string): Hmac;

  interface Hash {
    update(data: string): Hash;
    digest(encoding: 'hex'): string;
  }
  interface Hmac {
    update(data: string): Hmac;
    digest(encoding: 'hex'): string;
  }
}

declare module '@solana/web3.js' {
  export class Connection { constructor(url: string, commitment?: string); getTransaction(sig: string, opts?: any): Promise<any>; }
  export class Keypair { static fromSecretKey(key: Uint8Array): Keypair; publicKey: PublicKey; secretKey: Uint8Array; }
  export class Transaction { add(instruction: TransactionInstruction): Transaction; }
  export class TransactionInstruction { constructor(opts: { keys: any[]; programId: PublicKey; data: Buffer }); }
  export class PublicKey { constructor(key: string | Uint8Array); toBase58(): string; toBytes(): Uint8Array; }
  export function sendAndConfirmTransaction(conn: Connection, tx: Transaction, signers: Keypair[]): Promise<string>;
}

declare module 'tweetnacl' {
  interface DetachedSign {
    (message: Uint8Array, secretKey: Uint8Array): Uint8Array;
    verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean;
  }
  export const sign: { detached: DetachedSign };
}

declare class Buffer extends Uint8Array {
  static from(data: string | ArrayBuffer | ArrayLike<number>, encoding?: string): Buffer;
  static from(arrayBuffer: ArrayBuffer, byteOffset?: number, length?: number): Buffer;
  toString(encoding?: string): string;
}
