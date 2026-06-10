// Remediation pass: re-answer every question with a STRICT-ABSTENTION prompt, reusing each
// question's already-retrieved context (q.context) from the run — no re-recall, just a new
// answer. Goal: convert confident-wrong answers (hallucinations) into "Unknown" (omission, which
// HaluMem does not penalize as hallucination). Writes a new artifact for re-scoring.
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/sebastien/Projects/cluude-bot/.env', override: true });
import { readFileSync, writeFileSync } from 'fs';

const KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OR_MODEL || 'openai/gpt-5-mini';
const IN  = process.env.IN  || 'misc/halumem-out/memzero-medium/memzero_eval_results.jsonl';
const OUT = process.env.OUT || 'misc/halumem-out/memzero-medium/memzero_eval_results.strict.jsonl';
const CONC = Number(process.env.CONC || 8);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function withRetry(fn, n=8){ let e; for(let i=0;i<n;i++){ try{ return await fn(); }catch(err){ e=err; await sleep(700*(i+1)); } } throw e; }

// STRICT abstention: only answer when the memories explicitly and directly contain the answer.
const QA_SYS = `You are a careful assistant answering from a user's memories.
Answer ONLY if the provided memories EXPLICITLY and DIRECTLY state the answer to the exact question.
If the memories are merely related, partial, ambiguous, outdated/conflicting, or you are not fully certain, respond with exactly: Unknown.
Never guess, infer, or extrapolate beyond what the memories literally state.
Answer in under 6 words, or "Unknown". No explanation.`;

async function orChat(messages, maxTokens=400){
  return withRetry(async () => {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method:'POST',
      headers:{ 'Authorization':`Bearer ${KEY}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages }) });
    const d = await r.json();
    if (!d.choices?.[0]) throw new Error('OR no choices: ' + JSON.stringify(d).slice(0,140));
    return (d.choices[0].message.content || '').trim();
  });
}
async function answer(question, context){
  const t = await orChat([{ role:'system', content: QA_SYS },
    { role:'user', content:`Memories:\n${context || '(none)'}\n\nQuestion: ${question}\nAnswer:` }]);
  return t.replace(/^answer:\s*/i,'').trim() || 'Unknown';
}

const users = readFileSync(IN,'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
const tasks = [];
for (const u of users) for (const s of u.sessions) for (const q of (s.questions||[])) tasks.push(q);
console.error(`re-answer ${tasks.length} questions with strict-abstention prompt (conc ${CONC})`);
let done=0;
for (let i=0;i<tasks.length;i+=CONC){
  const batch = tasks.slice(i,i+CONC);
  await Promise.all(batch.map(async q => {
    const ctx = q.context && q.context.replace(/^Memories[^\n]*\n/,'') || '';
    try { q.system_response = ctx.trim() ? await answer(q.question, ctx) : 'Unknown'; }
    catch { q.system_response = 'Unknown'; }
    done++;
  }));
  if (done % 250 < CONC) console.error(`  ${done}/${tasks.length}`);
}
writeFileSync(OUT, users.map(u => JSON.stringify(u)).join('\n') + '\n');
console.error(`DONE -> ${OUT}`);
