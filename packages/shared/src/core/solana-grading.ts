/**
 * Solana grounding benchmark — shared grader + Q&A generator.
 * Used by both the benchmark script (misc/scripts) and the /ask server endpoint.
 */

export interface SolanaQA {
  id: string;
  category: string;
  question: string;
  gold: string;
  sourceRef: string;
}

// ---------------------------------------------------------------------------
// Abstention detection
// ---------------------------------------------------------------------------

const ABSTENTION_RE =
  /don'?t (have|know)|not enough info|no information|cannot determine|unable to|insufficient/i;

export function isAbstention(text: string): boolean {
  return ABSTENTION_RE.test(text);
}

// ---------------------------------------------------------------------------
// Category helpers
// ---------------------------------------------------------------------------

const NUMERIC_CATEGORIES = new Set([
  'tx_fee',
  'account_lamports',
  'block_txcount',
]);

const BASE58_EXACT_CATEGORIES = new Set(['account_owner', 'block_leader']);

const SUCCESS_SYNONYMS = new Set(['success', 'succeeded', 'ok', 'confirmed', 'true']);
const FAIL_SYNONYMS = new Set(['fail', 'failed', 'error', 'false']);

function normalizeStatus(text: string): 'success' | 'fail' | null {
  const lower = text.toLowerCase();
  for (const word of lower.split(/\W+/)) {
    if (SUCCESS_SYNONYMS.has(word)) return 'success';
    if (FAIL_SYNONYMS.has(word)) return 'fail';
  }
  return null;
}

function stripToNumber(text: string): number {
  // Keep digits, dot, minus; strip everything else (commas, units, spaces, words)
  const cleaned = text.replace(/[^0-9.\-]/g, '');
  return Number(cleaned);
}

// ---------------------------------------------------------------------------
// gradeAnswer
// ---------------------------------------------------------------------------

export function gradeAnswer(
  category: string,
  gold: string,
  predicted: string,
): boolean {
  // Abstention is never correct for a real fact
  if (isAbstention(predicted)) return false;

  if (NUMERIC_CATEGORIES.has(category)) {
    const goldNum = stripToNumber(gold);
    const predNum = stripToNumber(predicted);
    if (isNaN(goldNum) || isNaN(predNum)) return false;
    return goldNum === predNum;
  }

  if (BASE58_EXACT_CATEGORIES.has(category)) {
    // Case-sensitive — base58 is case-sensitive
    return predicted.includes(gold.trim());
  }

  if (category === 'token_symbol') {
    return predicted.toLowerCase().includes(gold.trim().toLowerCase());
  }

  if (category === 'tx_status') {
    const goldClass = normalizeStatus(gold);
    const predClass = normalizeStatus(predicted);
    if (goldClass === null || predClass === null) return false;
    return goldClass === predClass;
  }

  if (category === 'block_time') {
    // Accept if predicted contains the gold timestamp (lenient on surrounding text)
    return predicted.includes(gold.trim());
  }

  // Default: lowercase trim substring match
  return predicted.toLowerCase().includes(gold.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// factToQA
// ---------------------------------------------------------------------------

export function factToQA(fact: Record<string, string>): SolanaQA[] {
  const { id, category } = fact;
  const results: SolanaQA[] = [];

  function push(qaCategory: string, question: string, gold: string): void {
    if (!gold) return;
    results.push({ id: `${id}::${qaCategory}`, category: qaCategory, question, gold, sourceRef: id });
  }

  switch (category) {
    case 'block': {
      const { slot, block_time, leader, transaction_count } = fact;
      push('block_time', `What was the block time (UTC) of Solana slot ${slot}?`, block_time);
      push('block_leader', `Which validator led Solana slot ${slot}?`, leader);
      push('block_txcount', `How many transactions were in Solana slot ${slot}?`, transaction_count);
      break;
    }
    case 'tx': {
      const { signature, fee, status } = fact;
      push('tx_fee', `What fee in lamports did Solana transaction ${signature} pay?`, fee);
      push('tx_status', `Did Solana transaction ${signature} succeed or fail?`, status);
      break;
    }
    case 'account': {
      const { pubkey, owner, lamports } = fact;
      push('account_owner', `Which program owns Solana account ${pubkey}?`, owner);
      push('account_lamports', `How many lamports does Solana account ${pubkey} hold?`, lamports);
      break;
    }
    case 'token': {
      const { mint, symbol } = fact;
      push('token_symbol', `What is the ticker symbol of the Solana token mint ${mint}?`, symbol);
      break;
    }
    default:
      break;
  }

  return results;
}
