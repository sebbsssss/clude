/* proof.js — Public proof page for clude.io/proof
 * No build step. Vanilla JS, same-origin fetches.
 * Degrades gracefully on any fetch failure.
 */
(function () {
  'use strict';

  const API_BASE = '';

  /* ─── helpers ─────────────────────────────────── */

  function $(id) { return document.getElementById(id); }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = String(str == null ? '' : str);
    return d.innerHTML;
  }

  /** Format an integer with commas; >= 1M appends M suffix */
  function fmtTokens(n) {
    if (typeof n !== 'number' || isNaN(n)) return '—';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
    return n.toLocaleString();
  }

  function fmtInt(n) {
    if (typeof n !== 'number' || isNaN(n)) return '—';
    return Math.round(n).toLocaleString();
  }

  function fmtPct(n, decimals) {
    if (typeof n !== 'number' || isNaN(n)) return '—';
    const d = decimals ?? 1;
    return (n * 100).toFixed(d) + '%';
  }

  /* ─── NAV toggle ──────────────────────────────── */

  const navToggle = $('navToggle');
  if (navToggle) {
    navToggle.addEventListener('click', function () {
      this.classList.toggle('open');
      const links = document.querySelector('.nav-links');
      if (links) links.classList.toggle('open');
    });
  }

  /* ════════════════════════════════════════════════
     HERO — live token counter
     Polls /api/proof/tokens-saved every 10s.
     Animates a count-up on first load.
     Between polls uses ratePerMin to tick up gently.
  ═════════════════════════════════════════════════ */

  let _lastTotalSaved = null;
  let _ratePerMin     = 0;
  let _tickInterval   = null;

  function startTicker(currentTotal, ratePerMin) {
    if (_tickInterval) clearInterval(_tickInterval);
    if (!ratePerMin || ratePerMin <= 0) return;

    // tokens per second
    const tps = ratePerMin / 60;
    let displayed = currentTotal;

    _tickInterval = setInterval(function () {
      displayed += tps * 0.5; // tick every 500ms
      $('heroCounter').textContent = fmtTokens(Math.round(displayed));
    }, 500);
  }

  function animateCountUp(fromVal, toVal, durationMs, el) {
    if (!el) return;
    const start = performance.now();
    const from  = typeof fromVal === 'number' ? fromVal : 0;

    function frame(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / durationMs, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(from + (toVal - from) * eased);
      el.textContent = fmtTokens(current);
      if (progress < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  async function fetchTokensSaved() {
    try {
      const res = await fetch(API_BASE + '/api/proof/tokens-saved');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();

      const totalSaved   = typeof d.totalSaved    === 'number' ? d.totalSaved    : null;
      const savedToday   = typeof d.savedToday    === 'number' ? d.savedToday    : null;
      const avgSavingsPct= typeof d.avgSavingsPct === 'number' ? d.avgSavingsPct : null;
      const ratePerMin   = typeof d.ratePerMin    === 'number' ? d.ratePerMin    : 0;

      if (_tickInterval) clearInterval(_tickInterval);
      _tickInterval = null;

      if (totalSaved !== null) {
        const el = $('heroCounter');
        if (_lastTotalSaved === null) {
          // first load: animate from 0
          animateCountUp(0, totalSaved, 1800, el);
        } else {
          el.textContent = fmtTokens(totalSaved);
        }
        _lastTotalSaved = totalSaved;
        _ratePerMin = ratePerMin;
        startTicker(totalSaved, ratePerMin);
      } else {
        $('heroCounter').textContent = '—';
      }

      const heroLive = $('heroLive');
      const heroRate = $('heroRate');
      if (ratePerMin > 0 && heroLive && heroRate) {
        heroRate.textContent = fmtInt(ratePerMin) + ' tokens / min';
        heroLive.style.display = 'flex';
      } else if (heroLive) {
        heroLive.style.display = 'none';
      }

      if ($('heroSavedToday')) {
        $('heroSavedToday').textContent = savedToday !== null ? fmtTokens(savedToday) : '—';
      }
      if ($('heroAvgPct')) {
        $('heroAvgPct').textContent = avgSavingsPct !== null
          ? Math.round(avgSavingsPct) + '%' : '—';
      }

      // feed saved pct into the visualiser headline
      if (avgSavingsPct !== null) updateVisSavingsPct(avgSavingsPct);

    } catch (err) {
      // silent degradation — keep whatever is displayed
    }
  }

  fetchTokensSaved();
  setInterval(fetchTokensSaved, 10_000);

  /* ════════════════════════════════════════════════
     SECTION 1 — Token savings visualiser
     Pure client-side session simulation.
  ═════════════════════════════════════════════════ */

  const PRESETS = {
    conversation: {
      turns: [
        { text: 'How do I set up OAuth 2.0?',            base: 420,  clude: 380  },
        { text: 'What rate limits should we use?',       base: 980,  clude: 420  },
        { text: 'Remind me about the webhook bug.',      base: 1840, clude: 460  },
        { text: 'What did we decide on enterprise?',     base: 3100, clude: 480  },
        { text: 'What is the contractor budget?',         base: 4650, clude: 490  },
        { text: 'Summarise the migration plan.',         base: 6400, clude: 510  },
        { text: 'Any blockers with staging env?',        base: 8300, clude: 520  },
        { text: 'Finalise the deprecation timeline.',    base: 10500,clude: 530  },
      ],
    },
    technical: {
      turns: [
        { text: 'What embedding dimensions are we using?', base: 510,  clude: 390 },
        { text: 'What is our p99 latency?',                base: 1100, clude: 430 },
        { text: 'Recall the cross-tenant security bug.',  base: 2000, clude: 460 },
        { text: 'What was the hybrid search improvement?', base: 3200, clude: 480 },
        { text: 'Summarise the Cohere rerank decision.',  base: 5000, clude: 500 },
        { text: 'What is the monthly Pinecone cost?',      base: 7200, clude: 510 },
      ],
    },
    codebase: {
      turns: [
        { text: 'Where is auth middleware defined?',      base: 820,  clude: 410 },
        { text: 'What tables exist in the schema?',       base: 2100, clude: 450 },
        { text: 'What pattern does storeMemory follow?',  base: 3900, clude: 470 },
        { text: 'Explain the dream cycle phases.',        base: 6100, clude: 490 },
        { text: 'How is owner scoping enforced?',         base: 9000, clude: 510 },
        { text: 'What is the Supabase RPC for recall?',    base: 12500,clude: 530 },
        { text: 'Where is embeddings.ts used?',           base: 16400,clude: 550 },
      ],
    },
  };

  let _currentPreset = 'conversation';

  function setPreset(name) {
    _currentPreset = name;
    ['presetConv','presetTech','presetCode'].forEach(function (id) {
      const el = $(id);
      if (el) el.classList.remove('active');
    });
    const map = { conversation:'presetConv', technical:'presetTech', codebase:'presetCode' };
    if (map[name] && $(map[name])) $(map[name]).classList.add('active');
    renderVis();
  }

  // expose to global for onclick
  window.setPreset = setPreset;

  function renderVis() {
    const preset  = PRESETS[_currentPreset];
    if (!preset) return;

    const turns     = preset.turns;
    const withoutEl = $('visWithoutTurns');
    const withEl    = $('visWithTurns');
    if (!withoutEl || !withEl) return;

    let totalWithout = 0;
    let totalWith    = 0;

    // find max to scale bars
    const maxTokens = Math.max(...turns.map(t => t.base));

    const woHtml = turns.map(function (t, i) {
      totalWithout += t.base;
      const pct = Math.round((t.base / maxTokens) * 100);
      return '<div class="turn-item">' +
        '<div class="turn-idx">' + (i + 1) + '</div>' +
        '<div class="turn-text">' + esc(t.text) + '</div>' +
        '<div class="turn-tokens bad">' + t.base.toLocaleString() + '</div>' +
      '</div>';
    }).join('');

    const wHtml = turns.map(function (t, i) {
      totalWith += t.clude;
      return '<div class="turn-item">' +
        '<div class="turn-idx">' + (i + 1) + '</div>' +
        '<div class="turn-text">' + esc(t.text) + '</div>' +
        '<div class="turn-tokens good">' + t.clude.toLocaleString() + '</div>' +
      '</div>';
    }).join('');

    withoutEl.innerHTML = woHtml;
    withEl.innerHTML    = wHtml;

    const savedPct = totalWithout > 0
      ? Math.round(((totalWithout - totalWith) / totalWithout) * 100) : 0;

    if ($('visWithoutTotal')) $('visWithoutTotal').textContent = totalWithout.toLocaleString();
    if ($('visWithTotal'))    $('visWithTotal').textContent    = totalWith.toLocaleString();
    if ($('visSavedPct'))     $('visSavedPct').textContent     = savedPct + '%';

    const avgWithout = Math.round(totalWithout / turns.length);
    const avgWith    = Math.round(totalWith    / turns.length);
    if ($('visAvgWithout')) $('visAvgWithout').textContent = avgWithout.toLocaleString();
    if ($('visAvgWith'))    $('visAvgWith').textContent    = avgWith.toLocaleString();
  }

  /** Called when the live API returns an avgSavingsPct so the visualiser syncs */
  function updateVisSavingsPct(pct) {
    // The preset data already reflects realistic savings; we don't modify the
    // table data, but if the API number is materially different we note it.
    // (No-op for now — preset numbers are illustrative and independently calculated.)
  }

  renderVis();

  /* ════════════════════════════════════════════════
     SECTION 2 — Grounding / hallucination benchmark
  ═════════════════════════════════════════════════ */

  async function fetchGrounding() {
    const stateEl = $('groundingState');
    if (!stateEl) return;

    try {
      const res = await fetch(API_BASE + '/api/proof/hallucination');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();

      if (d.placeholder !== false) {
        // Show honest in-progress state
        renderGroundingPending(stateEl, d);
      } else {
        renderGroundingLive(stateEl, d);
      }
    } catch (err) {
      stateEl.innerHTML =
        '<div class="grounding-state">' +
          '<div class="grounding-pending">' +
            '<div class="pending-icon">&#x23F1;</div>' +
            '<div>' +
              '<div class="pending-title">Benchmark data unavailable</div>' +
              '<div class="pending-body">Could not reach the measurement endpoint. ' +
                'The live ask demo below still works.</div>' +
            '</div>' +
          '</div>' +
        '</div>';
    }
  }

  function renderGroundingPending(el, d) {
    const model   = d.model   || 'claude-haiku-4-5';
    const dataset = d.datasetVersion || 'crypto_solana_mainnet_us@2025-03-31';
    const note    = d.note    || 'Awaiting first benchmark run.';

    el.innerHTML =
      '<div class="grounding-state">' +
        '<div class="grounding-pending">' +
          '<div class="pending-icon">&#x23F3;</div>' +
          '<div>' +
            '<div class="pending-title">Measurement in progress</div>' +
            '<div class="pending-body">' +
              esc(note) +
              '<br><br>' +
              '<strong>Methodology:</strong> ' +
              fmtInt(d.n || 0) + ' questions answered by <code style="font-family:var(--mono);font-size:12px;">' +
              esc(model) + '</code> with and without Clude memory, ' +
              'against ground truth from <code style="font-family:var(--mono);font-size:12px;">' +
              esc(dataset) + '</code>. ' +
              'Results will appear here after the first full run completes. ' +
              'The live ask demo below demonstrates the abstain-vs-fabricate behavior right now.' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function renderGroundingLive(el, d) {
    const rate         = d.rate;
    const baselineRate = d.baselineRate;
    const n            = d.n || 0;
    const improvement  = (typeof baselineRate === 'number' && typeof rate === 'number')
      ? baselineRate - rate : null;

    const statsHtml =
      '<div class="grounding-live-stats">' +
        '<div class="g-stat">' +
          '<div class="g-stat-label">Clude hallucination rate</div>' +
          '<div class="g-stat-num green">' + fmtPct(rate) + '</div>' +
          '<div class="g-stat-sub">lower is better</div>' +
        '</div>' +
        '<div class="g-stat">' +
          '<div class="g-stat-label">Baseline (no memory)</div>' +
          '<div class="g-stat-num">' + fmtPct(baselineRate) + '</div>' +
          '<div class="g-stat-sub">same model, no Clude</div>' +
        '</div>' +
        '<div class="g-stat">' +
          '<div class="g-stat-label">Improvement</div>' +
          '<div class="g-stat-num green">' +
            (improvement !== null ? fmtPct(improvement) + ' fewer' : '—') +
          '</div>' +
          '<div class="g-stat-sub">n = ' + fmtInt(n) + ' questions</div>' +
        '</div>' +
      '</div>';

    const byCat = d.byCategory || {};
    const cats  = Object.keys(byCat);
    let catHtml = '';

    if (cats.length > 0) {
      const rows = cats.map(function (cat) {
        const c    = byCat[cat];
        const cr   = typeof c.rate         === 'number' ? c.rate         : null;
        const br   = typeof c.baselineRate === 'number' ? c.baselineRate : null;
        const pct  = cr !== null ? Math.round((1 - cr) * 100) : null; // accuracy pct
        return '<div class="cat-row">' +
          '<div class="cat-name">' + esc(cat.replace(/_/g, ' ')) + '</div>' +
          '<div class="cat-val good">' + (cr !== null ? fmtPct(cr) : '—') + '</div>' +
          '<div class="cat-val base">' + (br !== null ? fmtPct(br) : '—') + '</div>' +
          '<div class="cat-mini-bar">' +
            '<div class="cat-mini-track">' +
              '<div class="cat-mini-fill" style="width:' + (pct !== null ? (100 - pct) : 0) + '%"></div>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');

      catHtml =
        '<div class="cat-table">' +
          '<div class="cat-row head">' +
            '<div>Category</div>' +
            '<div>Clude rate</div>' +
            '<div>Baseline</div>' +
            '<div></div>' +
          '</div>' +
          rows +
        '</div>';
    }

    el.innerHTML = statsHtml + catHtml;
  }

  fetchGrounding();

  /* ── Examples ──────────────────────────────────── */

  async function fetchExamples() {
    const el = $('examplesContainer');
    if (!el) return;

    try {
      const res = await fetch(API_BASE + '/api/proof/hallucination/examples');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();

      const examples = Array.isArray(d.examples) ? d.examples : [];
      if (examples.length === 0) {
        renderExamplesEmpty(el);
      } else {
        renderExamples(el, examples);
      }
    } catch (err) {
      renderExamplesEmpty(el);
    }
  }

  function renderExamplesEmpty(el) {
    el.innerHTML =
      '<div class="example-empty">' +
        '<div class="empty-icon">&#x2610;</div>' +
        '<div class="empty-title">Curated examples publish after the first benchmark run</div>' +
        '<div class="empty-body">' +
          'Side-by-side comparisons of Clude&#x2019;s grounded answers vs baseline fabrications ' +
          'will appear here once the Solana grounding benchmark completes.' +
        '</div>' +
      '</div>';
  }

  function renderExamples(el, examples) {
    const MAX_SHOW = 4;
    const shown = examples.slice(0, MAX_SHOW);

    const html = shown.map(function (ex) {
      const q           = ex.question    || '';
      const cludeAns    = (ex.clude  && ex.clude.answer)    || '—';
      const baseAns     = (ex.baseline && ex.baseline.answer) || '—';
      const cludeOk     = ex.clude  && ex.clude.correct;
      const baseOk      = ex.baseline && ex.baseline.correct;

      return '<div class="examples-grid">' +
        '<div class="example-card">' +
          '<div class="example-side-label clude"><span class="mark">&#x2713;</span> Clude (with memory)</div>' +
          '<div class="example-q">' + esc(q) + '</div>' +
          '<div class="example-answer">' + esc(cludeAns) + '</div>' +
        '</div>' +
        '<div class="example-card">' +
          '<div class="example-side-label base"><span class="mark">&#x2717;</span> No-memory baseline</div>' +
          '<div class="example-q">' + esc(q) + '</div>' +
          '<div class="example-answer">' + esc(baseAns) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    el.innerHTML = html;
  }

  fetchExamples();

  /* ── Live ask ──────────────────────────────────── */

  let _askInFlight = false;

  window.setAskPreset = function (btn) {
    const q = btn.getAttribute('data-q');
    if (q && $('askInput')) $('askInput').value = q;
  };

  window.doAsk = async function () {
    if (_askInFlight) return;

    const input  = $('askInput');
    const btn    = $('askBtn');
    const status = $('askStatus');

    if (!input) return;
    const question = input.value.trim();
    if (!question) return;

    _askInFlight = true;
    if (btn) btn.disabled = true;
    if (status) { status.textContent = 'Asking…'; status.className = 'ask-status'; }

    const resultEl = $('askResult');
    if (resultEl) resultEl.classList.remove('visible');

    try {
      const res = await fetch(API_BASE + '/api/proof/hallucination/ask', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ question: question }),
      });

      if (res.status === 429) {
        if (status) {
          status.textContent = 'Rate limited — try again in a moment.';
          status.className   = 'ask-status err';
        }
        return;
      }

      if (!res.ok) {
        const errBody = await res.json().catch(function () { return {}; });
        if (status) {
          status.textContent = 'Error: ' + (errBody.error || 'HTTP ' + res.status);
          status.className   = 'ask-status err';
        }
        return;
      }

      const d = await res.json();

      // clear status
      if (status) { status.textContent = ''; }

      // populate panels
      const cludeAns    = (d.clude    && d.clude.answer)    || '(no answer)';
      const baseAns     = (d.baseline && d.baseline.answer) || '(no answer)';
      const cludeOk     = d.clude    && d.clude.correct;
      const baseOk      = d.baseline && d.baseline.correct;
      const hallucinated= d.hallucinated;

      if ($('askCludeAnswer')) $('askCludeAnswer').textContent = cludeAns;
      if ($('askBaseAnswer'))  $('askBaseAnswer').textContent  = baseAns;

      const cludeVerdict = $('askCludeVerdict');
      const baseVerdict  = $('askBaseVerdict');

      const cludeAbstained = /not enough information|i don'?t know|cannot determine|no information|abstain/i.test(cludeAns);

      if (cludeVerdict) {
        if (cludeAbstained) {
          cludeVerdict.textContent = 'Abstained — grounded behavior';
          cludeVerdict.className   = 'ask-verdict abstained';
        } else if (cludeOk) {
          cludeVerdict.textContent = 'Correct';
          cludeVerdict.className   = 'ask-verdict correct';
        } else {
          cludeVerdict.textContent = 'Answered';
          cludeVerdict.className   = 'ask-verdict';
        }
      }

      if (baseVerdict) {
        if (baseOk) {
          baseVerdict.textContent = 'Correct';
          baseVerdict.className   = 'ask-verdict correct';
        } else if (hallucinated) {
          baseVerdict.textContent = 'Hallucinated';
          baseVerdict.className   = 'ask-verdict wrong';
        } else {
          baseVerdict.textContent = 'Answered';
          baseVerdict.className   = 'ask-verdict';
        }
      }

      if (resultEl) resultEl.classList.add('visible');

    } catch (err) {
      if (status) {
        status.textContent = 'Network error — ' + err.message;
        status.className   = 'ask-status err';
      }
    } finally {
      _askInFlight = false;
      if (btn) btn.disabled = false;
    }
  };

  // Allow Enter key in the ask input
  (function () {
    const input = $('askInput');
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') window.doAsk();
      });
    }
  })();

})();
