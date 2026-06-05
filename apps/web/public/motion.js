// motion.js — Linear-grade motion layer for Clude.
// Scroll reveal · count-up · cursor-reactive glass · aurora parallax.
// Idempotent: safe to call after every React re-render.
(function () {
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── Reveal targets, in document order. Grouped siblings get stagger. ──────
  const REVEAL = [
    ".trusted-label", ".trusted-row",
    ".halluc-cap", ".halluc-figure", ".halluc-h", ".halluc-sub", ".halluc-step",
    ".section-head",
    ".comp-stat", ".comp-frame", ".comp-foot",
    ".scale-stat", ".vs-card", ".scale-verdict", ".scale-foot",
    ".problem-quote", ".problem-attribution",
    ".insight-text", ".insight-sub",
    ".showcase-frame",
    ".how-card", ".usecase", ".compare-wrap",
    ".stat-block", ".testimonial",
    ".founder-top", ".founder-aside", ".founder-main",
    ".trust-card",
    ".cta-band .eyebrow-row", ".cta-band h3", ".cta-band p", ".cta-actions", ".cta-foot"
  ].join(",");

  // ── Cards that get cursor-reactive highlight ──────────────────────────────
  const GLASS = ".usecase,.how-card,.halluc-step,.trust-card,.scale-stat,.stat-block,.vs-card,.testimonial,.compare-wrap,.scale-verdict";

  let io = null;

  function ensureObserver() {
    if (io || reduce) return;
    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
          if (e.target.hasAttribute("data-count")) runCount(e.target);
        }
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
  }

  function setupReveal() {
    const nodes = Array.from(document.querySelectorAll(REVEAL));
    // stagger by sibling index within shared parent
    const seen = new Map();
    nodes.forEach((el) => {
      if (el.dataset.mo === "1") return;
      el.dataset.mo = "1";
      el.classList.add("reveal");
      const p = el.parentElement;
      const i = (seen.get(p) || 0);
      seen.set(p, i + 1);
      el.style.setProperty("--rd", Math.min(i, 6) * 70 + "ms");
    });

    if (reduce) {
      nodes.forEach((el) => el.classList.add("in"));
      document.querySelectorAll("[data-count]").forEach((el) => { el.textContent = el.getAttribute("data-display") || el.textContent; });
      return;
    }
    ensureObserver();
    nodes.forEach((el) => {
      const r = el.getBoundingClientRect();
      // already on screen at init (e.g. after a re-render): show instantly, no flash
      if (r.top < window.innerHeight * 0.92 && r.bottom > 0) {
        el.classList.add("instant", "in");
        if (el.hasAttribute("data-count")) runCount(el, true);
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("instant")));
      } else {
        io.observe(el);
      }
    });
  }

  // ── Count-up ──────────────────────────────────────────────────────────────
  function fmt(v, decimals, comma) {
    let s = decimals > 0 ? v.toFixed(decimals) : Math.round(v).toString();
    if (comma) {
      const parts = s.split(".");
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      s = parts.join(".");
    }
    return s;
  }
  function runCount(el, instant) {
    if (el.dataset.counted === "1") return;
    el.dataset.counted = "1";
    const to = parseFloat(el.getAttribute("data-to"));
    const dec = parseInt(el.getAttribute("data-dec") || "0", 10);
    const comma = el.hasAttribute("data-comma");
    const pre = el.getAttribute("data-pre") || "";
    const suf = el.getAttribute("data-suf") || "";
    if (reduce || instant) { el.textContent = pre + fmt(to, dec, comma) + suf; return; }
    const dur = 1300, t0 = performance.now();
    const ease = (x) => 1 - Math.pow(1 - x, 4);
    function tick(now) {
      const p = Math.min((now - t0) / dur, 1);
      el.textContent = pre + fmt(to * ease(p), dec, comma) + suf;
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // ── Cursor-reactive glass (delegated, bound once) ─────────────────────────
  let glassBound = false;
  function setupGlass() {
    document.querySelectorAll(GLASS).forEach((el) => el.classList.add("spot"));
    if (glassBound || reduce) return;
    glassBound = true;
    document.addEventListener("pointermove", (e) => {
      const el = e.target.closest(GLASS);
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", (e.clientX - r.left) + "px");
      el.style.setProperty("--my", (e.clientY - r.top) + "px");
    }, { passive: true });
  }

  // ── Aurora parallax + nav condense (bound once) ───────────────────────────
  let scrollBound = false;
  function setupScroll() {
    if (scrollBound) return;
    scrollBound = true;
    const hero = document.querySelector(".hero");
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY;
        if (hero && !reduce) hero.style.setProperty("--py", (y * 0.18) + "px");
        const nav = document.querySelector(".nav");
        if (nav) nav.classList.toggle("scrolled", y > 12);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  window.initMotion = function () {
    setupReveal();
    setupGlass();
    setupScroll();
    // Linear-style hero entrance — play once on load
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        document.documentElement.classList.add("hero-in");
      });
    });
  };
})();
