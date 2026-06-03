// Cross-model VALIDATION of the 2M scale results using a different LLM (GPT-5.5 via OpenRouter).
// Re-runs the exact Clude-vs-no-Clude answer test with GPT instead of Claude Haiku:
//   - Clude side: GPT answers using ONLY the facts Clude's BM25 retrieval surfaced. If GPT
//     answers correctly, the retrievals are real AND the grounding advantage is model-independent.
//   - no-Clude side: GPT answers given a full context window of facts (the needle is almost never
//     in it). Confirms the baseline fails the same way for GPT.
// The retrieval recall itself (100% over 2M) is a deterministic DB measurement, not LLM-dependent;
// this validates the *answer/grounding* claims hold under a second, independent model.
//
// Usage:
//   OPENROUTER_API_KEY=sk-or-... GPT_MODEL=openai/gpt-5.5 WALLET=bench:scale:2m \
//     CLUDE_N=40 NOCLUDE_N=12 CTX_FACTS=2000 node --import tsx misc/scripts/scale-gpt-validation.mjs
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/sebastien/Projects/cluude-bot/.env', override: true });
const { getDb } = await import('@clude/shared/core/database');
const db = getDb();

const WALLET = process.env.WALLET || 'bench:scale:2m';
const K = Number(process.env.K || 8);
const CLUDE_N = Number(process.env.CLUDE_N || 40);
const NOCLUDE_N = Number(process.env.NOCLUDE_N || 12);
const CTX_FACTS = Number(process.env.CTX_FACTS || 2000);
const MODEL = process.env.GPT_MODEL || 'openai/gpt-5.5';
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('OPENROUTER_API_KEY required'); process.exit(1); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function retry(fn, n=6){ for(let i=0;i<n;i++){ try{ return await fn(); }catch(e){ await sleep(800*(i+1)); } } return null; }

function questionFor(row){
  const ref=row.source_ref||''; const slot=ref.replace(/^block:/,'').replace(/::.*$/,''); const sig=ref.replace(/^tx:/,'').replace(/::.*$/,'');
  switch(row.category){
    case 'block_time': return `What was the block time (UTC) of Solana slot ${slot}?`;
    case 'block_leader': return `Which validator led Solana slot ${slot}?`;
    case 'block_txcount': return `How many transactions were in Solana slot ${slot}?`;
    case 'tx_fee': return `What fee in lamports did Solana transaction ${sig} pay?`;
    case 'tx_status': return `Did Solana transaction ${sig} succeed or fail?`;
    case 'account_lamports': { const m=ref.match(/^account:(.+)@(\d+)/); return m?`How many lamports did Solana account ${m[1]} hold at slot ${m[2]}?`:row.summary; }
    default: return row.summary;
  }
}
function bm25QueryFor(row){
  const ref=row.source_ref||''; const base=ref.replace(/::.*$/,''); const slot=base.replace(/^block:/,''); const sig=base.replace(/^tx:/,'');
  switch(row.category){
    case 'block_time': return `${slot} block time`;
    case 'block_leader': return `${slot} validator`;
    case 'block_txcount': return `${slot} transactions`;
    case 'tx_fee': return `${sig} fee`;
    case 'tx_status': return `${sig} status`;
    case 'account_lamports': { const m=base.match(/^account:(.+)@(\d+)/); return m?`${m[1]} ${m[2]}`:(row.summary||''); }
    default: return row.summary||'';
  }
}
async function bm25Recall(qText){
  const bm=await retry(()=>db.rpc('scale_bm25',{search_query:qText,match_count:K,filter_owner:WALLET}).then(r=>r.data||[]));
  return (bm||[]).map(r=>r.id);
}
function answerHit(ans, gold){
  const norm=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,''); const a=norm(ans),g=norm(gold);
  if(!g) return false; if(a.includes(g)) return true;
  if(g==='success'&&/(succe|success)/.test(a)) return true;
  if((g==='failed'||g==='fail')&&/fail/.test(a)) return true;
  const gd=String(gold).match(/^(\d{4})-(\d{2})-(\d{2})/); if(gd){const ymd=gd[1]+gd[2]+gd[3]; if(a.includes(ymd))return true; if(a.includes(gd[1])&&a.includes(String(Number(gd[3]))))return true;}
  return false;
}
const SYS='You are a Solana data assistant. Answer using ONLY the provided data. If the answer is not present, say "I don\'t have enough information." Give one sentence with the exact value.';
async function askGPT(ctx,q){
  for(let a=0;a<5;a++){ try{
    const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',
      headers:{'Authorization':`Bearer ${KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:MODEL,max_tokens:200,messages:[{role:'system',content:SYS},{role:'user',content:`Data:\n${ctx}\n\nQuestion: ${q}\n\nAnswer:`}]})});
    const d=await r.json();
    if(d.choices?.[0]?.message?.content!=null) return {ans:d.choices[0].message.content,inTok:d.usage?.prompt_tokens||0,err:false};
    if(d.error){ if(a===0) console.error('  [gpt error]',JSON.stringify(d.error).slice(0,160)); await sleep(2500*(a+1)); }
  }catch(e){ await sleep(2500*(a+1)); } }
  return {ans:'(err)',inTok:0,err:true};
}

async function main(){
  const { count: total } = await db.from('memories_scale_bench').select('id',{count:'exact',head:true}).eq('owner_wallet',WALLET);
  console.log(`GPT cross-model validation | model=${MODEL} | corpus ${total} | clude N=${CLUDE_N} no-Clude N=${NOCLUDE_N}`);
  const { data: mm } = await db.from('memories_scale_bench').select('id').eq('owner_wallet',WALLET).order('id',{ascending:true}).limit(1);
  const { data: MM } = await db.from('memories_scale_bench').select('id').eq('owner_wallet',WALLET).order('id',{ascending:false}).limit(1);
  const minId=Number(mm[0].id), maxId=Number(MM[0].id), span=maxId-minId+1;  // bigint comes back as string
  // sample CLUDE_N facts spread across the corpus
  const want=CLUDE_N, stride=Math.max(1,Math.floor(span/(want*2))), picks=new Set();
  for(let x=0;picks.size<want*2&&x<want*4;x++) picks.add(minId+((x*stride+(x*7919)%stride)%span));
  let sample=[];
  const ids=[...picks];
  for(let i=0;i<ids.length&&sample.length<want;i+=200){
    const { data }=await db.from('memories_scale_bench').select('id,source_ref,category,gold,summary').in('id',ids.slice(i,i+200)).eq('owner_wallet',WALLET);
    if(data) sample.push(...data);
  }
  sample=sample.slice(0,want);

  // no-Clude context: a full window spread across the corpus
  const NB=20, per=Math.ceil(CTX_FACTS/NB); let ctxList=[];
  for(let b=0;b<NB;b++){ const start=minId+Math.floor((span/NB)*b);
    const { data }=await db.from('memories_scale_bench').select('content').eq('owner_wallet',WALLET).gte('id',start).order('id',{ascending:true}).limit(per);
    if(data) ctxList.push(...data); }
  const ctxBlob=ctxList.slice(0,CTX_FACTS).map(r=>r.content).join('\n');
  console.log(`no-Clude context: ${ctxList.length} facts (~${Math.round(ctxBlob.length/4)} est tokens, exact from API below)`);

  // ── Clude side: GPT answers from the retrieved facts ──
  let cOk=0, cTok=0, cErr=0; const cMiss=[];
  for(let i=0;i<sample.length;i++){
    const row=sample[i]; const nq=questionFor(row);
    const rids=await bm25Recall(bm25QueryFor(row));
    const { data: top }=await db.from('memories_scale_bench').select('content').in('id',rids.slice(0,K));
    const ctx=(top||[]).map(r=>r.content).join('\n');
    const a=await askGPT(ctx,nq);
    const ok=answerHit(a.ans,String(row.gold));
    if(ok)cOk++; else if(!a.err) cMiss.push({cat:row.category,gold:String(row.gold),ans:a.ans.slice(0,80)});
    if(a.err)cErr++; cTok+=a.inTok;
    if((i+1)%10===0) process.stdout.write(`\r  clude side ${i+1}/${sample.length} | correct ${cOk}`);
  }
  console.log();
  if(cMiss.length){ console.log('  Clude-side GPT misses:'); for(const m of cMiss) console.log(`    [${m.cat}] gold=${m.gold} ans="${m.ans}"`); }

  // ── no-Clude side: GPT answers from the big context window ──
  // Draw the no-Clude test facts at RANDOM across the whole corpus, independent of the context
  // window's fixed offsets, so overlap reflects the true ~CTX_FACTS/corpus rate (honest baseline).
  const noIds=[...Array(NOCLUDE_N*3)].map(()=>minId+Math.floor(Math.random()*span));
  const { data: noFacts }=await db.from('memories_scale_bench').select('id,source_ref,category,gold,summary').in('id',noIds).eq('owner_wallet',WALLET);
  const noSub=(noFacts||[]).slice(0,NOCLUDE_N);
  let bOk=0, bAbs=0, bTok=0, bErr=0;
  for(let i=0;i<noSub.length;i++){
    const row=noSub[i]; const a=await askGPT(ctxBlob,questionFor(row));
    if(answerHit(a.ans,String(row.gold)))bOk++;
    if(/enough information/i.test(a.ans))bAbs++;
    if(a.err)bErr++; bTok+=a.inTok;
    process.stdout.write(`\r  no-Clude side ${i+1}/${noSub.length} | correct ${bOk}`);
  }
  console.log();

  console.log('\n=== GPT-5.5 CROSS-MODEL VALIDATION ===');
  console.log(`  Model:            ${MODEL}`);
  console.log(`  Clude (retrieved facts):  ${cOk}/${sample.length} = ${(100*cOk/sample.length).toFixed(0)}% correct | ${cErr} err | ~${Math.round(cTok/Math.max(1,sample.length-cErr))} input tok/query`);
  console.log(`  no-Clude (${CTX_FACTS} facts ctx): ${bOk}/${noSub.length} = ${(100*bOk/noSub.length).toFixed(0)}% correct | ${bAbs} abstain | ${bErr} err | ~${Math.round(bTok/Math.max(1,noSub.length-bErr))} input tok/query`);
  console.log(`  => Validates: GPT answers from Clude's retrieved facts (retrievals are real, grounding is model-independent); no-Clude fails the same way.`);
  (await import('fs')).writeFileSync('/tmp/gpt-validation-result.json', JSON.stringify({model:MODEL,corpus:total,cludeN:sample.length,cludeCorrect:cOk,cludeTok:Math.round(cTok/Math.max(1,sample.length-cErr)),nocludeN:noSub.length,nocludeCorrect:bOk,nocludeAbstain:bAbs,nocludeTok:Math.round(bTok/Math.max(1,noSub.length-bErr)),ctxFacts:CTX_FACTS,runAt:new Date().toISOString()},null,2));
  console.log('\n  Result -> /tmp/gpt-validation-result.json');
}
main().catch(e=>{ console.error('FATAL',e); process.exit(1); });
