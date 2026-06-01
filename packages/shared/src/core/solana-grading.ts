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

// Single source of truth for "honest decline vs confident fabrication".
// A model that says "I don't have access to the Solana blockchain, use an
// explorer" is declining honestly, NOT hallucinating, so all of these
// no-access / can't-look-up / use-an-explorer phrasings must be caught.
const ABSTENTION_RE = new RegExp(
  [
    "don'?t (have|know)",
    'do not (have|know)',
    "(can'?t|cannot|unable to|not able to) (determine|provide|access|look up|verify|find|query|confirm|tell)",
    'not enough info',
    'no information',
    'insufficient',
    'no access',
    'without access',
    "(don'?t|do not) have (access|the ability|real-?time|enough)",
    'no real-?time',
    "i'?m not able",
    'i am not able',
    'use (a|an|the)? ?(solana |block )?explorer',
    'check (a|an|the)? ?(block )?explorer',
    'you can (use|check)',
    "you'?ll need to",
    'you would need to',
  ].join('|'),
  'i',
);

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

function commaGroup(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * True iff the integer `gold` appears as a STANDALONE number in `predicted`
 * (optionally thousands-separated). Crucially, it does NOT match digits that are
 * embedded inside an identifier (e.g. a base58 signature like "2P4iR5000xQ") or
 * concatenated with other numbers — comparing whole-string digit soup produced
 * false negatives whenever the reader restated the question's signature/pubkey.
 * String-based (no Number()), so it is exact for lamports beyond 2^53.
 */
function numericMatch(gold: string, predicted: string): boolean {
  const digits = gold.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
  if (!digits) return false;
  const grouped = commaGroup(digits);
  // Boundaries are non-alphanumeric (not \b), so a number inside a base58 token won't match.
  const re = new RegExp(`(?<![A-Za-z0-9])(?:${digits}|${grouped})(?![A-Za-z0-9])`);
  return re.test(predicted);
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
    return numericMatch(gold, predicted);
  }

  if (BASE58_EXACT_CATEGORIES.has(category)) {
    // Case-sensitive — base58 is case-sensitive
    return predicted.includes(gold.trim());
  }

  if (category === 'token_symbol') {
    // Token-boundary match (not substring): gold "SOL" must not match inside "Solana".
    const norm = (s: string) => s.trim().toLowerCase().replace(/^\$/, '');
    const goldSym = norm(gold);
    if (!goldSym) return false;
    const toks = predicted
      .toLowerCase()
      .split(/[^a-z0-9$]+/)
      .map((t) => t.replace(/^\$/, ''))
      .filter(Boolean);
    return toks.includes(goldSym);
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
