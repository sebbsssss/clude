/**
 * JEPA Evaluation Report
 *
 * Queries Supabase to measure two key signals:
 *   1. Hebbian reinforcement rate — what fraction of JEPA-created links have
 *      been co-retrieved enough to boost their strength above the initial 0.5
 *   2. Recent deep_connection dream log activity
 *
 * Run: pnpm tsx misc/scripts/jepa_eval_report.ts
 *
 * Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { createClient } from '@supabase/supabase-js'

async function main() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
    process.exit(1)
  }
  const supabase = createClient(url, key)

  // 1. Identify JEPA-created links
  //    The memory_links table has no source/metadata column; JEPA links are those
  //    where both the source_id and target_id appear in jepa_queried_memories.
  //    This is the correct proxy for links created by the JEPA dream phase.
  const { data: queriedMemories, error: qmError } = await supabase
    .from('jepa_queried_memories')
    .select('memory_id')

  if (qmError) {
    console.error('Failed to query jepa_queried_memories:', qmError.message)
    process.exit(1)
  }

  const queriedIds = (queriedMemories ?? []).map((r: any) => r.memory_id as number)

  console.log('=== JEPA Evaluation Report ===')
  console.log(`JEPA-queried memories: ${queriedIds.length}`)
  console.log()

  if (queriedIds.length === 0) {
    console.log('No JEPA-queried memories found. Has the dream cycle run yet?')
  } else {
    // Fetch links where source is a JEPA-queried memory
    const { data: jepaLinks, error: linksError } = await supabase
      .from('memory_links')
      .select('id, source_id, target_id, strength, created_at')
      .in('source_id', queriedIds)

    if (linksError) {
      console.error('Failed to query memory_links:', linksError.message)
      process.exit(1)
    }

    // Filter to links where both ends were JEPA-queried (the JEPA-created subset)
    const queriedSet = new Set(queriedIds)
    const jepaOnlyLinks = (jepaLinks ?? []).filter(
      (l: any) => queriedSet.has(l.source_id) && queriedSet.has(l.target_id)
    )

    const total = jepaOnlyLinks.length
    // Reinforced = strength has been boosted above initial 0.5 by ≥3 co-retrievals
    // Each Hebbian boost is +0.05, so 3 boosts → strength > 0.65
    const reinforced = jepaOnlyLinks.filter((l: any) => l.strength > 0.65).length
    const reinforcementRate = total > 0 ? reinforced / total : 0

    console.log('--- Signal 1: Hebbian Reinforcement ---')
    console.log(`Total JEPA links (both ends queried): ${total}`)
    console.log(`Reinforced (strength > 0.65, ≥3 co-retrievals): ${reinforced}`)
    console.log(`Reinforcement rate: ${(reinforcementRate * 100).toFixed(1)}%`)
    console.log(`Target: ≥15%`)
    console.log()

    if (total > 0) {
      const avgStrength =
        jepaOnlyLinks.reduce((sum: number, l: any) => sum + (l.strength as number), 0) / total
      console.log(`Average link strength: ${avgStrength.toFixed(3)}`)
      console.log()
    }
  }

  // 2. Recent deep_connection dream logs (Signal 2)
  const { data: topLogs, error: logsError } = await supabase
    .from('dream_logs')
    .select('output, created_at')
    .eq('session_type', 'deep_connection')
    .order('created_at', { ascending: false })
    .limit(20)

  if (logsError) {
    console.error('Failed to query dream_logs:', logsError.message)
    process.exit(1)
  }

  console.log('--- Signal 2: Recent Deep Connection Logs ---')
  for (const log of topLogs ?? []) {
    console.log(`[${log.created_at}] ${log.output}`)
  }

  if ((topLogs ?? []).length === 0) {
    console.log('(no deep_connection logs yet)')
  }

  console.log()
  console.log('=== End of Report ===')
}

main().catch(console.error)
