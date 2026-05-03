/* Live compaction demo — vanilla JS, runs after React mounts the JSX shell. */
(function () {
  function ready(cb) {
    if (document.getElementById('demoInput')) return cb();
    setTimeout(() => ready(cb), 50);
  }

  const PRESETS = {
    conversation: `Alice: Hey, we need to ship the v2 API by March 15. The authentication system needs to support OAuth 2.0 and API keys.
Bob: Got it. I've been looking at the rate limiting too. We should do 1000 req/min for free tier, 10000 for pro.
Alice: Good. Also, the webhook system from v1 is broken. Users are complaining about missed events. Priority fix.
Bob: Yeah I saw the Sentry alerts. It's the retry logic, it gives up after 2 attempts. Should be at least 5 with exponential backoff.
Alice: Agreed. Oh and Sarah from the enterprise team wants custom endpoints for Acme Corp. They need /api/v2/acme/inventory with special auth.
Bob: That's scope creep. Can we push that to v2.1?
Alice: No, it's in the contract. $50k/month deal. We ship it or we lose them.
Bob: Fine. I'll need the schema from Sarah. Also, the database migration for the new user roles table needs to happen before any of this.
Alice: Right. The roles are: admin, developer, viewer, billing. Each maps to different API scopes.
Bob: And we're deprecating the old permission system? That's going to break integrations.
Alice: 6 month deprecation window. Legacy endpoints stay alive but log warnings. We notify all API consumers by Feb 28.
Bob: Budget for this sprint? I might need to bring in a contractor for the webhook rewrite.
Alice: $15k contractor budget approved. Get someone who knows event-driven architectures.
Bob: One more thing, the staging environment is on us-east-1 but production is us-west-2. Latency testing is meaningless right now.
Alice: Move staging to us-west-2. DevOps ticket exists, just hasn't been prioritised.`,

    technical: `# Vector Embedding Architecture

Our embedding pipeline processes documents through three stages:

1. Chunking: Documents split into 512-token chunks with 50-token overlap. Using recursive character splitter.
2. Embedding: Each chunk embedded via text-embedding-3-small (1536 dimensions). Batch size 100, rate limited to 3000 RPM.
3. Storage: Vectors stored in Pinecone (us-east-1, p2 pod). Index: prod-docs-v3. Namespace per tenant.

Key metrics:
- Average query latency: 45ms (p50), 120ms (p99)
- Index size: 2.3M vectors across 847 tenants
- Monthly cost: $420 Pinecone + $380 OpenAI embeddings
- Recall@10: 0.89 on our eval set

Known issues:
- Cross-tenant data leak possible if namespace filter fails (CRITICAL, ticket SEC-441)
- Embedding drift when OpenAI silently updates model weights
- No reranking step. Adding Cohere rerank-v3 would improve recall to ~0.94.
- Chunking breaks code blocks and tables. Need AST-aware splitter for code docs.

The hybrid search (BM25 + vector) experiment showed 12% improvement on technical queries. Implementation requires Elasticsearch sidecar. Estimated 2 weeks eng time.

Contact: embedding-team@company.com. On-call rotation: Mon/Wed Jake, Tue/Thu Maria, Fri/Weekend rotating.`,

    meeting: `Meeting: Q1 Planning, Product & Engineering
Date: Feb 15, 2026
Attendees: Sarah (CEO), Mike (CTO), Lisa (Product), Dave (Eng Lead), Jenny (Design)

Sarah opened with revenue update: $2.1M ARR, up 34% QoQ. Enterprise pipeline has $800k in late-stage deals. Biggest risk: Acme Corp ($200k) threatens to churn if we don't ship SSO by April.

Mike presented the technical roadmap:
- SSO/SAML integration: 6 weeks, needs 2 backend engineers
- Mobile app v2: 8 weeks, React Native rewrite. Current app has 2.1 stars on App Store.
- API v3: 4 weeks, breaking changes. Need migration guide.
- Infrastructure: Moving from Heroku to AWS. $3k/month savings. 3 week migration.

Lisa pushed back on mobile timeline. User research shows 67% of users access via mobile. Every week of delay costs ~$40k in potential conversions. Proposed hiring a mobile contractor at $180/hr.

Dave flagged tech debt: test coverage at 43%. Last two deploys caused incidents. Wants 20% of sprint capacity for reliability work.

Jenny presented new dashboard designs. A/B test on the onboarding flow showed 28% improvement in activation. Ready to ship.

Decisions:
1. SSO is top priority. Pull Mike and Dave full-time.
2. Approve mobile contractor. Lisa to source candidates by Feb 22.
3. 15% sprint capacity for tech debt (compromise from Dave's 20%).
4. Ship onboarding A/B test winner immediately.
5. AWS migration starts March 1, must be done by March 21 (before Q1 close).

Action items:
- Sarah: Send SSO requirements to Mike by Feb 17
- Mike: Technical spec for SSO by Feb 20
- Lisa: Mobile contractor shortlist by Feb 22
- Dave: Tech debt prioritisation list by Feb 18
- Jenny: Final onboarding designs to dev by Feb 16

Next meeting: Feb 22, same time.`,
  };

  let demoStep = 0;
  let originalContent = '';
  let originalFacts = [];
  let originalEntities = [];
  let withoutState = { content: '' };
  let cludeState = { memories: [], entities: new Set(), totalFacts: 0 };
  let autoInterval = null;

  function $(id) { return document.getElementById(id); }

  function extractFacts(text) {
    const sentences = text.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 15);
    const facts = [];
    for (const s of sentences) {
      if (/\d/.test(s) || /[A-Z][a-z]+/.test(s) || /should|need|must|will|decided|approved/i.test(s)) {
        facts.push(s.slice(0, 120));
      }
    }
    return [...new Set(facts)];
  }

  function extractEntities(text) {
    const entities = new Set();
    const nameMatches = text.match(/(?:^|\. )([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/g) || [];
    nameMatches.forEach(m => {
      const name = m.replace(/^\. /, '').trim();
      if (name.length > 2 && !['The','This','That','But','And','Also','Got','Yes','One','Our','Key','No'].includes(name)) {
        entities.add(name);
      }
    });
    (text.match(/\$[\d,.]+[kKmM]?/g) || []).forEach(m => entities.add(m));
    (text.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d+/g) || []).forEach(m => entities.add(m));
    (text.match(/[A-Z]{2,}[\w-]*/g) || []).forEach(m => { if (m.length > 2 && m.length < 20) entities.add(m); });
    return [...entities];
  }

  function classifyMemory(text) {
    if (/decided|approved|action|ship|priority|must|should/i.test(text)) return 'procedural';
    if (/\d+%|\$[\d]+|metric|latency|cost|revenue/i.test(text)) return 'semantic';
    if (/I think|feels|concern|risk|worry|pushed back/i.test(text)) return 'self_model';
    return 'episodic';
  }

  function summarize(fact) { return fact.length > 100 ? fact.slice(0, 97) + '…' : fact; }

  function compactWithout(content, s) {
    const sentences = content.split(/(?<=[.!?\n])\s+/).filter(x => x.trim().length > 5);
    if (sentences.length <= 2) return content;
    const keepRatio = Math.max(0.55, 0.85 - s * 0.03);
    const kept = [];
    for (const sent of sentences) {
      const hasNumber = /\d/.test(sent);
      const hasName = /[A-Z][a-z]{2,}/.test(sent);
      const importance = (hasNumber ? 0.3 : 0) + (hasName ? 0.2 : 0) + Math.random() * 0.5;
      if (importance > (1 - keepRatio)) {
        let d = sent;
        if (s > 3)  d = d.replace(/\b\d{1,2}:\d{2}\b/g, '[time]');
        if (s > 5)  d = d.replace(/\$[\d,.]+[kKmM]?/g, '[amount]');
        if (s > 8)  d = d.replace(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*/g, '[day]');
        if (s > 10) d = d.replace(/[A-Z][a-z]+(?:\s[A-Z][a-z]+)/g, '[person]');
        if (s > 13) d = d.replace(/\b\d+%/g, '[percent]');
        if (s > 15) d = d.replace(/\b\d+\b/g, '[num]');
        kept.push(d);
      }
    }
    return kept.join(' ').trim() || '[Context window exhausted. All specific information lost.]';
  }

  function compactClude(content, s) {
    if (s === 0) {
      const facts = extractFacts(content);
      const entities = extractEntities(content);
      cludeState.memories = facts.map((f, i) => ({
        id: i,
        type: classifyMemory(f),
        content: summarize(f),
        importance: 0.3 + Math.random() * 0.5,
        decay: 1.0,
        accessCount: 0,
      }));
      cludeState.entities = new Set(entities);
      cludeState.totalFacts = facts.length;
      return;
    }
    for (const mem of cludeState.memories) {
      mem.decay = Math.max(0.1, mem.decay - 0.02);
      if (mem.importance > 0.5) {
        mem.accessCount++;
        mem.importance = Math.min(1.0, mem.importance + 0.02);
        mem.decay = Math.min(1.0, mem.decay + 0.01);
      }
      if (mem.importance < 0.35) mem.decay = Math.max(0.05, mem.decay - 0.03);
    }
    if (s % 4 === 0 && cludeState.memories.length > 5) {
      const weakest = cludeState.memories.filter(m => m.importance < 0.4 && m.decay < 0.5).slice(0, 2);
      if (weakest.length === 2) {
        weakest[0].content = 'Consolidated · ' + weakest[0].content.slice(0, 40) + ' + ' + weakest[1].content.slice(0, 40);
        weakest[0].type = 'semantic';
        weakest[0].importance = Math.max(weakest[0].importance, weakest[1].importance);
        cludeState.memories = cludeState.memories.filter(m => m !== weakest[1]);
      }
    }
  }

  function renderWithout() {
    const el = $('withoutContent');
    el.textContent = withoutState.content || '[empty]';
    el.className = 'demo__panel-body' + (demoStep > 10 ? ' is-degraded' : '');

    const currentFacts = extractFacts(withoutState.content);
    const retention = originalContent.length > 0
      ? Math.round((withoutState.content.length / originalContent.length) * 100) : 100;
    $('withoutChars').textContent = withoutState.content.length.toLocaleString();
    $('withoutRetention').textContent = Math.min(100, retention) + '%';
    $('withoutFacts').textContent = currentFacts.length;
    const entitiesLost = originalEntities.filter(e => !withoutState.content.includes(e)).length;
    $('withoutEntitiesLost').textContent = entitiesLost;

    $('barWithout').style.width = Math.min(100, retention) + '%';
    $('barWithout').textContent = Math.min(100, retention) + '%';
    const factRetention = originalFacts.length > 0 ? Math.round((currentFacts.length / originalFacts.length) * 100) : 100;
    $('barFactsWithout').style.width = factRetention + '%';
    $('barFactsWithout').textContent = currentFacts.length;
    const entRetention = originalEntities.length > 0
      ? Math.round(((originalEntities.length - entitiesLost) / originalEntities.length) * 100) : 100;
    $('barEntWithout').style.width = entRetention + '%';
    $('barEntWithout').textContent = (originalEntities.length - entitiesLost);
  }

  function renderClude() {
    const el = $('cludeContent');
    el.className = 'demo__panel-body';
    el.innerHTML = '';

    const sorted = [...cludeState.memories].sort((a, b) => (b.importance * b.decay) - (a.importance * a.decay));
    for (const mem of sorted) {
      const item = document.createElement('div');
      item.className = 'demo__memory-item demo__memory-item--' + mem.type;
      item.style.opacity = Math.max(0.3, mem.decay).toString();
      const decayLow = mem.decay <= 0.5;
      item.innerHTML = `
        <div>${mem.content}</div>
        <div class="demo__memory-meta">
          <span class="demo__memory-type">${mem.type.replace('_', ' ')}</span>
          <span>imp ${mem.importance.toFixed(2)}<span class="demo__bar"><span class="demo__bar-fill" style="width:${mem.importance*100}%"></span></span></span>
          <span>decay ${mem.decay.toFixed(2)}<span class="demo__bar"><span class="demo__bar-fill demo__bar-fill--decay${decayLow ? ' is-low' : ''}" style="width:${mem.decay*100}%"></span></span></span>
          <span>access ${mem.accessCount}×</span>
        </div>
      `;
      el.appendChild(item);
    }

    const entitySection = $('entitySection');
    if (cludeState.entities.size > 0) {
      entitySection.style.display = 'flex';
      entitySection.innerHTML = '';
      for (const e of cludeState.entities) {
        const tag = document.createElement('span');
        tag.className = 'demo__entity';
        tag.textContent = e;
        entitySection.appendChild(tag);
      }
    }

    const activeMems = cludeState.memories.filter(m => m.decay > 0.15);
    const factRetention = cludeState.totalFacts > 0 ? Math.round((activeMems.length / cludeState.totalFacts) * 100) : 100;
    const cludeRet = Math.min(100, Math.max(factRetention, 70 + Math.min(demoStep, 10)));

    $('cludeMemories').textContent = cludeState.memories.length;
    $('cludeRetention').textContent = cludeRet + '%';
    $('cludeFacts').textContent = activeMems.length;
    $('cludeEntities').textContent = cludeState.entities.size;

    $('barWith').style.width = cludeRet + '%';
    $('barWith').textContent = cludeRet + '%';
    $('barFactsWith').style.width = Math.min(100, (activeMems.length / Math.max(1, originalFacts.length)) * 100) + '%';
    $('barFactsWith').textContent = activeMems.length;
    $('barEntWith').style.width = '100%';
    $('barEntWith').textContent = cludeState.entities.size;
  }

  function startCompaction() {
    originalContent = $('demoInput').value.trim();
    if (!originalContent) {
      alert('Paste some content, upload a file, or pick a sample first.');
      return;
    }
    originalFacts = extractFacts(originalContent);
    originalEntities = extractEntities(originalContent);
    demoStep = 0;
    withoutState.content = originalContent;
    compactClude(originalContent, 0);
    renderWithout();
    renderClude();
    $('scoresPanel').style.display = 'block';
    $('stepBtn').disabled = false;
    $('autoBtn').disabled = false;
    $('stepNum').textContent = '0';
    $('startBtn').textContent = 'Restart compaction →';
  }

  function stepCompaction() {
    if (demoStep >= 20) return;
    demoStep++;
    withoutState.content = compactWithout(withoutState.content, demoStep);
    compactClude(null, demoStep);
    renderWithout();
    renderClude();
    $('stepNum').textContent = demoStep;
    $('withoutPanel').classList.add('is-flash');
    $('withPanel').classList.add('is-flash');
    setTimeout(() => {
      $('withoutPanel').classList.remove('is-flash');
      $('withPanel').classList.remove('is-flash');
    }, 400);
    if (demoStep >= 20) {
      $('stepBtn').disabled = true;
      $('autoBtn').disabled = true;
    }
  }

  function autoCompact() {
    if (autoInterval) {
      clearInterval(autoInterval);
      autoInterval = null;
      $('autoBtn').textContent = 'Auto (20×)';
      return;
    }
    $('autoBtn').textContent = 'Stop auto';
    autoInterval = setInterval(() => {
      if (demoStep >= 20) {
        clearInterval(autoInterval);
        autoInterval = null;
        $('autoBtn').textContent = 'Auto (20×)';
        return;
      }
      stepCompaction();
    }, 600);
  }

  function resetAll() {
    if (autoInterval) { clearInterval(autoInterval); autoInterval = null; }
    demoStep = 0;
    originalContent = '';
    originalFacts = [];
    originalEntities = [];
    withoutState = { content: '' };
    cludeState = { memories: [], entities: new Set(), totalFacts: 0 };
    const wo = $('withoutContent');
    wo.textContent = 'Paste content and hit Start to begin.';
    wo.className = 'demo__panel-body demo__panel-body--empty';
    const wc = $('cludeContent');
    wc.textContent = 'Paste content and hit Start to begin.';
    wc.className = 'demo__panel-body demo__panel-body--empty';
    $('entitySection').style.display = 'none';
    $('scoresPanel').style.display = 'none';
    $('stepBtn').disabled = true;
    $('autoBtn').disabled = true;
    $('autoBtn').textContent = 'Auto (20×)';
    $('startBtn').textContent = 'Start compaction →';
    $('stepNum').textContent = '0';
    ['withoutChars','withoutFacts','withoutEntitiesLost','cludeMemories','cludeFacts','cludeEntities'].forEach(id => {
      $(id).textContent = '0';
    });
    ['withoutRetention','cludeRetention'].forEach(id => {
      $(id).textContent = '100%';
    });
  }

  ready(function init() {
    const ta = $('demoInput');
    if (ta && !ta.value) ta.value = PRESETS.conversation;

    document.querySelectorAll('.demo__preset[data-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-preset');
        if (PRESETS[key]) $('demoInput').value = PRESETS[key];
      });
    });

    $('demoUpload').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 500_000) { alert('File too large. Please upload under 500 KB.'); return; }
      const reader = new FileReader();
      reader.onload = (ev) => { $('demoInput').value = ev.target.result; };
      reader.readAsText(file);
    });

    $('startBtn').addEventListener('click', startCompaction);
    $('stepBtn').addEventListener('click', stepCompaction);
    $('autoBtn').addEventListener('click', autoCompact);
    $('resetBtn').addEventListener('click', resetAll);
  });
})();
