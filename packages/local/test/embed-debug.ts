import { embed, cosineSim } from '../src/embeddings.js';

async function main() {
  const q1 = await embed("what programming language does the user prefer?");
  const a1 = await embed("User prefers dark mode and works primarily in TypeScript and React");
  const a2 = await embed("User prefers concise responses, no fluff or filler words");
  
  const q2 = await embed("coffee preferences");
  const a3 = await embed("User drinks oat milk lattes, usually from a cafe called Common Man");
  const a4 = await embed("User prefers concise responses, no fluff or filler words");
  
  console.log("'programming language' vs 'TypeScript+React':", cosineSim(q1, a1).toFixed(3));
  console.log("'programming language' vs 'concise responses':", cosineSim(q1, a2).toFixed(3));
  console.log("'coffee' vs 'oat milk lattes':", cosineSim(q2, a3).toFixed(3));
  console.log("'coffee' vs 'concise responses':", cosineSim(q2, a4).toFixed(3));
  
  // Test if summary-based embedding helps
  const s1 = await embed("User works in TypeScript and React");
  const s3 = await embed("User drinks oat milk lattes from Common Man cafe");
  console.log("\n'programming language' vs summary 'TypeScript+React':", cosineSim(q1, s1).toFixed(3));
  console.log("'coffee' vs summary 'oat milk lattes':", cosineSim(q2, s3).toFixed(3));
}
main().catch(console.error);
