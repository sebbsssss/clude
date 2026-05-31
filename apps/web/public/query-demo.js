/* query-demo.js — Public proof page for clude.io/query-demo
 * No build step. Vanilla JS, same-origin fetches.
 * Degrades gracefully on any fetch failure.
 */
(function () {
  'use strict';

  const API_BASE = '';

  /* ─── pricing constant ────────────────────────── */
  // Claude Opus input pricing: $15 per 1M tokens
  const COST_PER_MTOK = 15;

  /** Format a USD cost value as compact string: $25.2K, $1.23M, etc. */
  function fmtCostUsd(costUsd) {
    if (typeof costUsd !== 'number' || isNaN(costUsd)) return '…';
    if (costUsd >= 1_000_000) return '$' + (costUsd / 1_000_000).toFixed(2) + 'M';
    if (costUsd >= 1_000)     return '$' + (costUsd / 1_000).toFixed(1) + 'K';
    return '$' + Math.round(costUsd).toLocaleString();
  }

  /* ─── helpers ─────────────────────────────────── */

  function $(id) { return document.getElementById(id); }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = String(str == null ? '' : str);
    return d.innerHTML;
  }

  /** Format an integer with commas; >= 1B appends B suffix, >= 1M appends M suffix */
  function fmtTokens(n) {
    if (typeof n !== 'number' || isNaN(n)) return '…';
    if (n >= 1e9)       return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
    return n.toLocaleString();
  }

  function fmtInt(n) {
    if (typeof n !== 'number' || isNaN(n)) return '…';
    return Math.round(n).toLocaleString();
  }

  function fmtPct(n, decimals) {
    if (typeof n !== 'number' || isNaN(n)) return '…';
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

      const totalSaved    = typeof d.totalSaved    === 'number' ? d.totalSaved    : null;
      const savedToday    = typeof d.savedToday    === 'number' ? d.savedToday    : null;
      const avgSavingsPct = typeof d.avgSavingsPct === 'number' ? d.avgSavingsPct : null;
      const ratePerMin    = typeof d.ratePerMin    === 'number' ? d.ratePerMin    : 0;

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
        $('heroCounter').textContent = '…';
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
        $('heroSavedToday').textContent = savedToday !== null ? fmtTokens(savedToday) : '…';
      }
      if ($('heroAvgPct')) {
        $('heroAvgPct').textContent = avgSavingsPct !== null
          ? Math.round(avgSavingsPct) + '%' : '…';
      }

      // Compute and display USD value of tokens saved
      if ($('heroCostUsd')) {
        if (totalSaved !== null) {
          const costUsd = (totalSaved / 1_000_000) * COST_PER_MTOK;
          $('heroCostUsd').textContent = fmtCostUsd(costUsd);
        } else {
          $('heroCostUsd').textContent = '…';
        }
      }

      // Feed live savings % into the shout-out callout and visualiser
      if (avgSavingsPct !== null) {
        updateShoutSavings(avgSavingsPct);
        updateVisSavingsPct(avgSavingsPct);
      }

    } catch (err) {
      // silent degradation — keep whatever is displayed
    }
  }

  fetchTokensSaved();
  setInterval(fetchTokensSaved, 10_000);

  /* ─── Shout-out savings callout ────────────────── */

  /**
   * When the API returns a real avgSavingsPct, promote it into the big
   * shout-out number so the page always shows the live figure.
   */
  function updateShoutSavings(pct) {
    const el  = $('shoutSavingsPct');
    const src = $('shoutSavingsSource');
    if (el && typeof pct === 'number' && !isNaN(pct)) {
      el.textContent = Math.round(pct) + '%';
    }
    if (src) {
      src.textContent = 'Live figure from /api/proof/tokens-saved.';
    }
  }

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
        { text: 'What is the contractor budget?',        base: 4650, clude: 490  },
        { text: 'Summarise the migration plan.',         base: 6400, clude: 510  },
        { text: 'Any blockers with staging env?',        base: 8300, clude: 520  },
        { text: 'Finalise the deprecation timeline.',    base: 10500,clude: 530  },
      ],
    },
    technical: {
      turns: [
        { text: 'What embedding dimensions are we using?', base: 510,  clude: 390 },
        { text: 'What is our p99 latency?',                base: 1100, clude: 430 },
        { text: 'Recall the cross-tenant security bug.',   base: 2000, clude: 460 },
        { text: 'What was the hybrid search improvement?', base: 3200, clude: 480 },
        { text: 'Summarise the Cohere rerank decision.',   base: 5000, clude: 500 },
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
        { text: 'What is the Supabase RPC for recall?',   base: 12500,clude: 530 },
        { text: 'Where is embeddings.ts used?',           base: 16400,clude: 550 },
      ],
    },
  };

  let _currentPreset    = 'conversation';
  // If the API supplies a real savings %, we'll use it to override the
  // visualiser's headline pct so the two numbers stay in sync.
  let _liveAvgSavingsPct = null;

  function setPreset(name) {
    _currentPreset = name;
    ['presetConv','presetTech','presetCode'].forEach(function (id) {
      const el = $(id);
      if (el) el.classList.remove('active');
    });
    const map = { conversation:'presetConv', technical:'presetTech', codebase:'presetCode' };
    if (map[name] && $(map[name])) $(map[name]).classList.add('active');
    renderVis();
    renderMechanismChart();
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

    const woHtml = turns.map(function (t, i) {
      totalWithout += t.base;
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

    // Prefer live API rate if available; fall back to preset-derived pct
    let savedPct;
    if (_liveAvgSavingsPct !== null) {
      savedPct = Math.round(_liveAvgSavingsPct);
    } else {
      savedPct = totalWithout > 0
        ? Math.round(((totalWithout - totalWith) / totalWithout) * 100) : 0;
    }

    if ($('visWithoutTotal')) $('visWithoutTotal').textContent = totalWithout.toLocaleString();
    if ($('visWithTotal'))    $('visWithTotal').textContent    = totalWith.toLocaleString();
    if ($('visSavedPct'))     $('visSavedPct').textContent     = savedPct + '%';

    const avgWithout = Math.round(totalWithout / turns.length);
    const avgWith    = Math.round(totalWith    / turns.length);
    if ($('visAvgWithout')) $('visAvgWithout').textContent = avgWithout.toLocaleString();
    if ($('visAvgWith'))    $('visAvgWith').textContent    = avgWith.toLocaleString();

    // Update the live anchor note
    const anchorEl = $('visLiveAnchor');
    if (anchorEl) {
      if (_liveAvgSavingsPct !== null) {
        anchorEl.innerHTML =
          'Headline rate <span class="anchor-live">' + savedPct + '%</span>' +
          ' is live from the API. Preset illustrates the per-turn mechanism.';
      } else {
        anchorEl.textContent =
          'Preset illustrates mechanism. Headline rate anchored to live API when available.';
      }
    }
  }

  /**
   * Called when the live API returns an avgSavingsPct.
   * Stores it and re-renders the vis so the big pct number stays in sync.
   */
  function updateVisSavingsPct(pct) {
    if (typeof pct !== 'number' || isNaN(pct)) return;
    _liveAvgSavingsPct = pct;
    renderVis();
    renderMechanismChart();
  }

  /* ─── Per-turn mechanism bar chart ─────────────── */

  /**
   * Renders the per-turn growing-context bar chart in #mechanismChart.
   * Two column groups per turn: Without (growing, red) vs With (flat, green).
   * Bars animate in via CSS transitions once the element is observed.
   */
  function renderMechanismChart() {
    const chartEl = $('mechanismChart');
    if (!chartEl) return;

    const preset = PRESETS[_currentPreset];
    if (!preset) return;

    const turns = preset.turns;
    const maxBase = Math.max.apply(null, turns.map(function (t) { return t.base; }));

    // Build column pairs
    const cols = turns.map(function (t, i) {
      const withoutPct = maxBase > 0 ? Math.round((t.base  / maxBase) * 100) : 0;
      const withPct    = maxBase > 0 ? Math.round((t.clude / maxBase) * 100) : 0;
      // Cap with-Clude bar at a minimum visible height
      const withPctShow = Math.max(withPct, 2);
      return (
        '<div class="mech-col-group">' +
          '<div class="mech-col-pair">' +
            '<div class="mech-bar mech-bar-without" style="--target-h:' + withoutPct + '%;"></div>' +
            '<div class="mech-bar mech-bar-with"    style="--target-h:' + withPctShow + '%;"></div>' +
          '</div>' +
          '<div class="mech-turn-label">T' + (i + 1) + '</div>' +
        '</div>'
      );
    }).join('');

    chartEl.innerHTML =
      '<div class="mech-chart-inner">' +
        '<div class="mech-y-axis">' +
          '<span>Max</span>' +
          '<span>½</span>' +
          '<span>0</span>' +
        '</div>' +
        '<div class="mech-bars-area">' +
          cols +
        '</div>' +
      '</div>' +
      '<div class="mech-legend">' +
        '<span class="mech-legend-item mech-legend-without">Without Clude: full transcript re-sent</span>' +
        '<span class="mech-legend-item mech-legend-with">With Clude: only recalled memories</span>' +
      '</div>';

    // Trigger CSS transitions after a microtask so the element is painted
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        const bars = chartEl.querySelectorAll('.mech-bar');
        bars.forEach(function (b) { b.classList.add('mech-bar-animate'); });
      });
    });
  }

  // Intersection Observer: animate chart when scrolled into view
  (function () {
    function doAnimate() {
      const chartEl = $('mechanismChart');
      if (!chartEl) return;
      const bars = chartEl.querySelectorAll('.mech-bar');
      bars.forEach(function (b) { b.classList.add('mech-bar-animate'); });
    }

    if ('IntersectionObserver' in window) {
      const obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            doAnimate();
            obs.disconnect();
          }
        });
      }, { threshold: 0.15 });

      const chartEl = $('mechanismChart');
      if (chartEl) obs.observe(chartEl);
    }
  })();

  renderVis();
  renderMechanismChart();

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
                'The live ask demo above still works.</div>' +
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
              'The live ask demo above demonstrates the abstain-vs-fabricate behavior right now.' +
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

    // When benchmark runs for real, the hallucination rate becomes the big shout-out.
    // The rate is already a proportion (0-1); display as pct.
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
            (improvement !== null ? fmtPct(improvement) + ' fewer' : '…') +
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
        const pct  = cr !== null ? Math.round((1 - cr) * 100) : null;
        return '<div class="cat-row">' +
          '<div class="cat-name">' + esc(cat.replace(/_/g, ' ')) + '</div>' +
          '<div class="cat-val good">' + (cr !== null ? fmtPct(cr) : '…') + '</div>' +
          '<div class="cat-val base">' + (br !== null ? fmtPct(br) : '…') + '</div>' +
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
    // Make sure the shared header stays hidden when there are no examples
    const header = $('examplesHeader');
    if (header) header.style.display = 'none';

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

  /**
   * Build a Solscan URL from a sourceRef string like "block:271462400".
   * Returns an anchor HTML string, or '' if sourceRef is absent/unparseable.
   */
  function buildSolscanHtml(sourceRef) {
    if (!sourceRef || typeof sourceRef !== 'string') return '';
    const colonIdx = sourceRef.indexOf(':');
    if (colonIdx === -1) return '';
    const refType  = sourceRef.slice(0, colonIdx).trim().toLowerCase();
    const refValue = sourceRef.slice(colonIdx + 1).trim();
    const typeMap  = { block: 'block', tx: 'tx', account: 'account', token: 'token' };
    const path     = typeMap[refType];
    if (!path || !refValue) return '';
    const url = 'https://solscan.io/' + path + '/' + esc(refValue);
    return ' <a href="' + url + '" target="_blank" rel="noopener noreferrer" ' +
      'style="font-family:var(--mono);font-size:10px;letter-spacing:0.5px;' +
      'color:var(--blue);border-bottom:1px solid rgba(34,68,255,0.35);">' +
      'Verify on Solscan &#x2197;</a>';
  }

  function renderExamples(el, examples) {
    const MAX_SHOW = 4;
    const shown = examples.slice(0, MAX_SHOW);

    // Show the persistent column headers now that we have real examples
    const header = $('examplesHeader');
    if (header) header.style.display = 'grid';

    const html = shown.map(function (ex) {
      const q          = ex.question                         || '';
      const cludeAns   = (ex.clude    && ex.clude.answer)    || '…';
      const baseAns    = (ex.baseline && ex.baseline.answer) || '…';
      const sourceRef  = ex.sourceRef || null;
      const groundTruth = ex.groundTruth || null;
      // Detect honest baseline decline vs hallucination
      const hallucinated  = ex.hallucinated === true;
      const baseAbstained = /not enough information|i don'?t know|cannot determine|no information|abstain|don't have access|no data/i.test(baseAns);

      let baseVerdictHtml = '';
      if (ex.baseline && ex.baseline.correct === true) {
        baseVerdictHtml = '<div class="ask-verdict correct" style="font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-top:10px;padding-top:8px;border-top:1px solid var(--border);">✓ Correct</div>';
      } else if (hallucinated) {
        baseVerdictHtml = '<div class="ask-verdict wrong" style="font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-top:10px;padding-top:8px;border-top:1px solid var(--border);">✗ Hallucinated: confident wrong answer</div>';
      } else if (baseAbstained) {
        baseVerdictHtml = '<div class="ask-verdict abstained" style="font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-top:10px;padding-top:8px;border-top:1px solid var(--border);">Declined: no data access (honest)</div>';
      }

      const solscanHtml = buildSolscanHtml(sourceRef);
      const gtHtml = groundTruth
        ? '<div style="font-family:var(--mono);font-size:10px;color:var(--muted);letter-spacing:0.5px;margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">Verified: <strong style="color:var(--text);">' + esc(groundTruth) + '</strong>' + solscanHtml + '</div>'
        : (solscanHtml ? '<div style="margin-top:8px;">' + solscanHtml + '</div>' : '');

      return '<div class="examples-grid">' +
        '<div class="example-card">' +
          '<div class="example-q">' + esc(q) + '</div>' +
          '<div class="example-answer">' + esc(cludeAns) + '</div>' +
          gtHtml +
        '</div>' +
        '<div class="example-card">' +
          '<div class="example-q">' + esc(q) + '</div>' +
          '<div class="example-answer">' + esc(baseAns) + '</div>' +
          baseVerdictHtml +
        '</div>' +
      '</div>';
    }).join('');

    el.innerHTML = html;
  }

  fetchExamples();

  /* ════════════════════════════════════════════════
     SECTION 2 — Live ask demo
     Backed by /proof/solana-qa.json (cached on first fetch).
     Preset buttons + shuffle pick a random item by category
     and submit { questionId } to /api/proof/hallucination/ask.
     Free-text falls back to { question }.
  ═════════════════════════════════════════════════ */

  // Cache for the QA dataset
  let _qaItems = null;
  // The questionId most recently submitted (set by shuffle/presets, cleared by free-text)
  let _pendingQuestionId = null;

  async function loadQaItems() {
    if (_qaItems !== null) return _qaItems;
    try {
      const res = await fetch('/proof/solana-qa.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();
      _qaItems = Array.isArray(d.items) ? d.items : [];
    } catch (_) {
      _qaItems = [];
    }
    return _qaItems;
  }

  /**
   * Pick a random item (optionally filtered by category).
   * Returns null if the dataset is empty or category has no items.
   */
  function pickRandom(category) {
    if (!_qaItems || _qaItems.length === 0) return null;
    const pool = category
      ? _qaItems.filter(function (it) { return it.category === category; })
      : _qaItems;
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * Toggle the loading state across the ask UI: spinner on the shuffle button,
   * spinner in the status line, disabled presets + ask button. Called the moment
   * the user clicks Shuffle / a preset so the loading is immediately apparent,
   * then cleared in doAsk's finally block.
   */
  function setAskLoading(on) {
    const btn        = $('askBtn');
    const shuffleBtn = $('askShuffleBtn');
    const status     = $('askStatus');
    const presets    = document.querySelectorAll('.ask-preset');
    if (on) {
      if (btn) btn.disabled = true;
      if (shuffleBtn) {
        if (!shuffleBtn.dataset.label) shuffleBtn.dataset.label = shuffleBtn.innerHTML;
        shuffleBtn.classList.add('loading');
        shuffleBtn.innerHTML = '<span class="ask-spinner ask-spinner-on-blue"></span>Loading a grounded answer…';
      }
      presets.forEach(function (p) { p.disabled = true; });
      if (status) {
        status.innerHTML = '<span class="ask-spinner"></span>Querying Clude memory and the same model without the data…';
        status.className = 'ask-status';
      }
    } else {
      if (btn) btn.disabled = false;
      if (shuffleBtn) {
        shuffleBtn.classList.remove('loading');
        if (shuffleBtn.dataset.label) {
          shuffleBtn.innerHTML = shuffleBtn.dataset.label;
          delete shuffleBtn.dataset.label;
        }
      }
      presets.forEach(function (p) { p.disabled = false; });
    }
  }

  /**
   * Called by the "Shuffle a real Solana fact" button and category presets.
   * Loads dataset if needed, picks a random item, populates the input, and submits.
   */
  window.shuffleAsk = async function (category) {
    // Show loading immediately on click (dataset fetch + LLM round-trip follows)
    setAskLoading(true);
    await loadQaItems();
    const item = pickRandom(category || null);
    if (!item) {
      const input = $('askInput');
      if (input && input.value.trim()) {
        // Free-text already present, let doAsk handle it (keeps loading on)
        window.doAsk();
      } else {
        // Nothing to ask yet: clear loading and nudge the user
        setAskLoading(false);
        const status = $('askStatus');
        if (status) {
          status.textContent = 'Dataset still loading, try again in a moment.';
          status.className = 'ask-status';
        }
      }
      return;
    }
    const input = $('askInput');
    if (input) input.value = item.question;
    _pendingQuestionId = item.id;
    window.doAsk();
  };

  let _askInFlight = false;

  window.doAsk = async function () {
    if (_askInFlight) return;

    const input  = $('askInput');
    const btn    = $('askBtn');
    const status = $('askStatus');

    if (!input) return;
    const question = input.value.trim();
    if (!question) return;

    _askInFlight = true;
    setAskLoading(true);

    // Hide empty state, hide results while loading
    const pendingState  = $('askPendingState');
    const resultHeader  = $('askResultHeader');
    const resultEl      = $('askResult');
    if (pendingState)  pendingState.classList.add('hidden');
    if (resultHeader)  resultHeader.style.display = 'none';
    if (resultEl)      resultEl.classList.remove('visible');

    // Capture and clear the pending questionId (so a subsequent free-text ask doesn't reuse it)
    const questionId = _pendingQuestionId;
    _pendingQuestionId = null;

    try {
      // Prefer questionId (grounded via dataset) over raw question text
      const body = questionId
        ? { questionId: questionId }
        : { question: question };

      const res = await fetch(API_BASE + '/api/proof/hallucination/ask', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      if (res.status === 429) {
        if (status) {
          status.textContent = 'Rate limited. Try again in a moment.';
          status.className   = 'ask-status err';
        }
        // Restore pending state
        if (pendingState) pendingState.classList.remove('hidden');
        return;
      }

      if (!res.ok) {
        const errBody = await res.json().catch(function () { return {}; });
        if (status) {
          status.textContent = 'Error: ' + (errBody.error || 'HTTP ' + res.status);
          status.className   = 'ask-status err';
        }
        if (pendingState) pendingState.classList.remove('hidden');
        return;
      }

      const d = await res.json();

      // clear status
      if (status) { status.textContent = ''; }

      // Populate panels
      const cludeAns     = (d.clude    && d.clude.answer)    || '(no answer)';
      const baseAns      = (d.baseline && d.baseline.answer) || '(no answer)';
      const cludeOk      = d.clude    && d.clude.correct === true;
      const baseOk       = d.baseline && d.baseline.correct === true;
      const hallucinated = d.hallucinated;
      const groundTruth  = d.groundTruth || null;
      const grounded     = d.clude && d.clude.grounded; // 'dataset'|'memory'|'none'
      const sourceRef    = d.sourceRef || null; // e.g. "block:123456" | "tx:<sig>" | null

      // Left panel: Clude
      const cludeAnswerEl  = $('askCludeAnswer');
      const cludeVerdictEl = $('askCludeVerdict');
      const groundedTagEl  = $('askGroundedTag');
      const groundTruthEl  = $('askGroundTruth');

      if (cludeAnswerEl) cludeAnswerEl.textContent = cludeAns;

      // Grounded tag
      if (groundedTagEl) {
        if (grounded === 'dataset') {
          groundedTagEl.textContent = 'grounded in dataset';
          groundedTagEl.className   = 'ask-grounded-tag ask-grounded-dataset';
        } else if (grounded === 'memory') {
          groundedTagEl.textContent = 'grounded in memory';
          groundedTagEl.className   = 'ask-grounded-tag ask-grounded-memory';
        } else {
          groundedTagEl.textContent = '';
          groundedTagEl.className   = 'ask-grounded-tag';
        }
      }

      const cludeAbstained = /not enough information|i don'?t know|cannot determine|no information|abstain/i.test(cludeAns);

      if (cludeVerdictEl) {
        if (cludeAbstained) {
          cludeVerdictEl.textContent = '✓ Abstained: grounded behavior';
          cludeVerdictEl.className   = 'ask-verdict abstained';
        } else if (cludeOk) {
          cludeVerdictEl.textContent = '✓ Correct';
          cludeVerdictEl.className   = 'ask-verdict correct';
        } else {
          cludeVerdictEl.textContent = 'Answered';
          cludeVerdictEl.className   = 'ask-verdict';
        }
      }

      // Ground truth row + Solscan verification link
      if (groundTruthEl) {
        if (groundTruth) {
          groundTruthEl.style.display = 'block';
          const gtValueEl = $('askGroundTruthValue');
          if (gtValueEl) gtValueEl.textContent = groundTruth;
        } else {
          groundTruthEl.style.display = 'none';
        }
      }

      // Build Solscan verification link from sourceRef (e.g. "block:271462400")
      // Split on the FIRST colon only — tx signatures and pubkeys won't have colons,
      // but we're defensive about it regardless.
      const solscanLinkEl = $('askSolscanLink');
      if (solscanLinkEl) {
        solscanLinkEl.innerHTML = '';
        if (sourceRef && typeof sourceRef === 'string') {
          const colonIdx = sourceRef.indexOf(':');
          if (colonIdx !== -1) {
            const refType  = sourceRef.slice(0, colonIdx).trim().toLowerCase();
            const refValue = sourceRef.slice(colonIdx + 1).trim();
            const SOLSCAN_BASE = 'https://solscan.io';
            const typeMap = { block: 'block', tx: 'tx', account: 'account', token: 'token' };
            const path = typeMap[refType];
            if (path && refValue) {
              const url = SOLSCAN_BASE + '/' + path + '/' + refValue;
              const a = document.createElement('a');
              a.href      = url;
              a.target    = '_blank';
              a.rel       = 'noopener noreferrer';
              a.textContent = ' Verify on Solscan ↗';
              a.style.cssText = [
                'font-family:var(--mono)',
                'font-size:10px',
                'letter-spacing:0.5px',
                'color:var(--blue)',
                'border-bottom:1px solid rgba(34,68,255,0.35)',
                'margin-left:6px',
                'white-space:nowrap',
              ].join(';');
              a.addEventListener('mouseenter', function () {
                this.style.borderBottomColor = 'var(--blue)';
              });
              a.addEventListener('mouseleave', function () {
                this.style.borderBottomColor = 'rgba(34,68,255,0.35)';
              });
              solscanLinkEl.appendChild(a);
            }
          }
        }
      }

      // Right panel: baseline
      // Distinguish honest decline/abstain from an actual hallucination.
      // hallucinated flag = baseline gave a confident WRONG answer (not an abstention).
      const baseAnswerEl  = $('askBaseAnswer');
      const baseVerdictEl = $('askBaseVerdict');
      if (baseAnswerEl)  baseAnswerEl.textContent  = baseAns;

      // Detect abstention pattern in baseline answer
      const baseAbstained = /not enough information|i don'?t know|cannot determine|no information|abstain|don't have access|no data/i.test(baseAns);

      if (baseVerdictEl) {
        if (baseOk) {
          baseVerdictEl.textContent = '✓ Correct';
          baseVerdictEl.className   = 'ask-verdict correct';
        } else if (hallucinated) {
          // API confirmed: confident wrong answer → true hallucination
          baseVerdictEl.textContent = '✗ Hallucinated: confident wrong answer';
          baseVerdictEl.className   = 'ask-verdict wrong';
        } else if (baseAbstained) {
          // Honest decline: no data access → not a hallucination
          baseVerdictEl.textContent = 'Declined: no data access (honest)';
          baseVerdictEl.className   = 'ask-verdict abstained';
        } else {
          baseVerdictEl.textContent = 'Answered';
          baseVerdictEl.className   = 'ask-verdict';
        }
      }

      // Show column headers and results
      if (resultHeader) resultHeader.style.display = 'grid';
      if (resultEl)     resultEl.classList.add('visible');

      // Show the honest framing note below result panels
      const framingNoteEl = $('askFramingNote');
      if (framingNoteEl) framingNoteEl.style.display = 'block';

    } catch (err) {
      if (status) {
        status.textContent = 'Network error: ' + err.message;
        status.className   = 'ask-status err';
      }
      if (pendingState) pendingState.classList.remove('hidden');
    } finally {
      _askInFlight = false;
      setAskLoading(false);
    }
  };

  // Allow Enter key in the ask input; Enter clears questionId → free-text mode
  (function () {
    const input = $('askInput');
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          _pendingQuestionId = null; // typed → free-text
          window.doAsk();
        }
      });
      // If the user edits the field manually, drop the pending questionId
      input.addEventListener('input', function () {
        _pendingQuestionId = null;
      });
    }
  })();

  // Pre-load dataset in the background so shuffle feels instant
  loadQaItems();

})();
