/**
 * Lexical content-token maintenance (PMP memory encryption §6/§9).
 *
 * content_tokens is the keyword index over plaintext content. PostgREST can't
 * express to_tsvector inline, so a tiny RPC builds it from a transient plaintext
 * argument (never stored as a column). Error-tolerant: a missing RPC or failure
 * degrades keyword recall but must never fail the write.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('content-tokens');

/** Populate content_tokens for a memory from its plaintext content. */
export async function setContentTokens(
  db: SupabaseClient,
  memoryId: number,
  plaintext: string
): Promise<void> {
  try {
    const { error } = await db.rpc('set_memory_content_tokens', {
      p_memory_id: memoryId,
      p_text: plaintext,
    });
    if (error) {
      log.warn({ memoryId, error: error.message }, 'set_memory_content_tokens failed (keyword recall degraded)');
    }
  } catch (err) {
    log.warn({ memoryId, err }, 'set_memory_content_tokens threw (keyword recall degraded)');
  }
}
