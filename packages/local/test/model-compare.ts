async function main() {
  const { pipeline } = await import('@xenova/transformers');

  function cos(a: number[], b: number[]): number {
    let d=0,ma=0,mb=0;
    for(let i=0;i<a.length;i++){d+=a[i]*b[i];ma+=a[i]*a[i];mb+=b[i]*b[i]}
    return d/(Math.sqrt(ma)*Math.sqrt(mb));
  }

  const pairs = [
    ['User prefers dark mode and works in TypeScript', 'what programming language does the user like?'],
    ['The API rate limit is 100 requests per minute', 'API rate limits'],
    ['CLUDE uses four memory types: episodic, semantic, procedural, and self_model', 'how does CLUDE memory work?'],
    ['Seb resigned from StarHub to build independently', 'who is Seb and what does he do?'],
    ['Deploy to production using Railway with Dockerfile', 'how do I deploy my app?'],
  ];

  const models = [
    'Xenova/all-MiniLM-L6-v2',
    'Xenova/gte-small',
    'Xenova/bge-small-en-v1.5',
  ];

  for (const model of models) {
    console.log(`\n=== ${model} ===`);
    const t0 = performance.now();
    const pipe = await pipeline('feature-extraction', model, { quantized: true });
    console.log(`  Loaded in ${(performance.now()-t0).toFixed(0)}ms`);

    for (const [doc, query] of pairs) {
      const e1 = await pipe(doc, { pooling: 'mean', normalize: true });
      const e2 = await pipe(query, { pooling: 'mean', normalize: true });
      const sim = cos(Array.from(e1.data), Array.from(e2.data));
      console.log(`  ${sim.toFixed(3)} | "${query.slice(0,40)}" ↔ "${doc.slice(0,40)}"`);
    }
  }
}
main().catch(console.error);
