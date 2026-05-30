import { describe, it, expect } from 'vitest';
import { gradeAnswer, isAbstention, factToQA } from '../solana-grading.js';

describe('gradeAnswer', () => {
  it('numeric (tx_fee): matches ignoring separators/units', () => {
    expect(gradeAnswer('tx_fee', '5000', 'The fee was 5,000 lamports')).toBe(true);
    expect(gradeAnswer('tx_fee', '5000', '4999')).toBe(false);
  });
  it('base58 (account_owner): case-SENSITIVE exact', () => {
    const k = 'Vote111111111111111111111111111111111111111';
    expect(gradeAnswer('account_owner', k, `It is owned by ${k}`)).toBe(true);
    expect(gradeAnswer('account_owner', k, k.toLowerCase())).toBe(false);
  });
  it('token_symbol: case-insensitive', () => {
    expect(gradeAnswer('token_symbol', 'USDC', 'usdc')).toBe(true);
  });
  it('tx_status: success/fail synonyms', () => {
    expect(gradeAnswer('tx_status', 'Success', 'the transaction succeeded')).toBe(true);
    expect(gradeAnswer('tx_status', 'Success', 'it failed')).toBe(false);
  });
  it('an abstention answer never grades correct on a real fact', () => {
    expect(gradeAnswer('tx_fee', '5000', "I don't have enough information")).toBe(false);
  });
  it('numeric: matches a standalone number even when the answer restates a digit-bearing signature', () => {
    expect(gradeAnswer('tx_fee', '5000', 'Transaction 2P4iR9xZ5q paid 5000 lamports')).toBe(true);
  });
  it('numeric: does NOT match digits embedded in an identifier or a different number', () => {
    // "5000" appears only inside the base58 token, and the real fee is 7000
    expect(gradeAnswer('tx_fee', '5000', 'Transaction 5000ZxQk paid 7000 lamports')).toBe(false);
  });
  it('numeric: matches thousands-separated and is exact for large lamports', () => {
    expect(gradeAnswer('account_lamports', '1447680', 'It holds 1,447,680 lamports')).toBe(true);
    expect(gradeAnswer('account_lamports', '12345678901234567', 'balance is 12345678901234567 lamports')).toBe(true);
  });
  it('token_symbol: token-boundary, no substring false-positive', () => {
    expect(gradeAnswer('token_symbol', 'SOL', 'it is a Solana token')).toBe(false);
    expect(gradeAnswer('token_symbol', 'SOL', 'The symbol is SOL.')).toBe(true);
    expect(gradeAnswer('token_symbol', '$FEDUP', 'ticker: $FEDUP')).toBe(true);
  });
});

describe('isAbstention', () => {
  it('detects refusals/idk', () => {
    expect(isAbstention("I don't have enough information")).toBe(true);
    expect(isAbstention('not enough info to answer')).toBe(true);
    expect(isAbstention('The fee was 5000 lamports')).toBe(false);
  });
});

describe('factToQA', () => {
  it('builds exact-ground-truth QA from a tx fact (fee + status)', () => {
    const qas = factToQA({ id:'tx:abc', category:'tx', signature:'abc', block_slot:'1', fee:'5000', status:'Success', compute_units:'450' });
    const fee = qas.find(q => q.category === 'tx_fee');
    expect(fee).toBeTruthy();
    expect(fee!.gold).toBe('5000');
    expect(fee!.question).toContain('abc');
  });
  it('builds block_time QA from a block fact', () => {
    const qas = factToQA({ id:'block:9', category:'block', slot:'9', block_time:'2025-03-25T00:00:00Z', leader:'Lead11', transaction_count:'1665', block_hash:'h' });
    expect(qas.some(q => q.category === 'block_time' && q.gold === '2025-03-25T00:00:00Z')).toBe(true);
  });
});
