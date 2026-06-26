/**
 * pack-title-card — renders a Clude pack's 1-of-1 title NFT image as an SVG card.
 *
 * This is the OFF-CHAIN image referenced by the title's Metaplex metadata `image` field
 * (served by pack-title.routes). It shows ONLY public, non-sensitive facts about the pack:
 * its name, memory count, creation date, short pack id, the mint, and the chain. No owner
 * wallet, no memory contents, no PII — a title NFT is public by nature, so the card stays
 * public-safe by construction.
 *
 * SECURITY: the pack `name` is user-controlled, so EVERY interpolated string is XML-escaped
 * via `esc()` before it enters the SVG. Without that a pack named `</text><script>…` would
 * inject markup into the rendered document. Numbers are coerced + clamped.
 *
 * Fonts: we request Inter / JetBrains Mono but fall back to generic sans/mono families so the
 * card still rasterises on a server whose fontconfig only has DejaVu (sharp → librsvg).
 */

const C = {
  bg: '#0a0b0f',
  panel: '#12141c',
  border: '#222634',
  borderAccent: '#4466ff',
  fg: '#f4f5f7',
  muted: '#8a8f9c',
  faint: '#5a6072',
  accent: '#5b7cff',
  accentSoft: 'rgba(91,124,255,0.14)',
} as const;

const SANS = "Inter, 'Helvetica Neue', 'Segoe UI', Arial, sans-serif";
const MONO = "'JetBrains Mono', 'SFMono-Regular', ui-monospace, 'DejaVu Sans Mono', monospace";

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface PackTitleCardInput {
  name: string;
  memoryCount: number;
  dateISO?: string | null;
  packId: string;
  mintAddress?: string | null;
  chain?: string | null;
}

/** XML-escape for safe interpolation into SVG/XML text and attribute values. */
export function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

/** Greedy word-wrap a display name into at most `maxLines` lines of ~`maxChars`, ellipsising overflow. */
export function wrapName(name: string, maxChars = 20, maxLines = 2): string[] {
  const clean = String(name).replace(/\s+/g, ' ').trim() || 'Untitled Pack';
  const words = clean.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const word = w.length > maxChars ? w.slice(0, maxChars - 1) + '…' : w;
    if (!cur) {
      cur = word;
    } else if ((cur + ' ' + word).length <= maxChars) {
      cur += ' ' + word;
    } else {
      lines.push(cur);
      cur = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  // If we ran out of lines but words remain, ellipsise the last line.
  const consumed = lines.join(' ').split(' ').length;
  if (consumed < words.length && lines.length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = (last.length > maxChars - 1 ? last.slice(0, maxChars - 1) : last) + '…';
  }
  return lines.length ? lines : ['Untitled Pack'];
}

/** Short, human "Jun 26, 2026" from an ISO date; '' when absent/unparseable (no locale dependence). */
export function formatCardDate(dateISO?: string | null): string {
  if (!dateISO) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateISO);
  if (!m) return '';
  const year = m[1];
  const month = MONTHS[Math.max(0, Math.min(11, Number(m[2]) - 1))];
  const day = String(Number(m[3]));
  return `${month} ${day}, ${year}`;
}

/** Truncate a base58 address to `head…tail` for the card footer. */
function shortAddr(a?: string | null, head = 4, tail = 4): string {
  if (!a) return '';
  return a.length <= head + tail + 1 ? a : `${a.slice(0, head)}…${a.slice(-tail)}`;
}

/** Render the title card as a 1000×1000 SVG string. Pure: same input → same output. */
export function renderPackTitleCardSvg(input: PackTitleCardInput): string {
  const count = Number.isFinite(input.memoryCount) ? Math.max(0, Math.floor(input.memoryCount)) : 0;
  const nameLines = wrapName(input.name);
  const date = formatCardDate(input.dateISO);
  const packShort = esc(shortAddr(input.packId, 9, 4));
  const mintShort = input.mintAddress ? esc(shortAddr(input.mintAddress)) : '';
  const chain = input.chain ? esc(input.chain) : '';

  // Name block: 1 or 2 lines, baseline-anchored around y=430.
  const nameY = nameLines.length === 1 ? 452 : 410;
  const nameSvg = nameLines
    .map((ln, i) => `<text x="84" y="${nameY + i * 78}" font-family="${SANS}" font-size="64" font-weight="700" fill="${C.fg}">${esc(ln)}</text>`)
    .join('');

  const footerBits: string[] = [`<tspan fill="${C.muted}">${packShort}</tspan>`];
  if (mintShort) footerBits.push(`<tspan fill="${C.faint}">   ·   </tspan><tspan fill="${C.muted}">${mintShort}</tspan>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0c0e15"/>
      <stop offset="1" stop-color="#070810"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.82" cy="0.12" r="0.7">
      <stop offset="0" stop-color="#4466ff" stop-opacity="0.20"/>
      <stop offset="1" stop-color="#4466ff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1000" height="1000" fill="url(#bg)"/>
  <rect width="1000" height="1000" fill="url(#glow)"/>
  <rect x="28" y="28" width="944" height="944" rx="28" fill="${C.panel}" fill-opacity="0.45" stroke="${C.border}" stroke-width="1.5"/>
  <rect x="28" y="28" width="944" height="944" rx="28" fill="none" stroke="${C.borderAccent}" stroke-opacity="0.18" stroke-width="3"/>

  <!-- Wordmark -->
  <circle cx="96" cy="104" r="11" fill="${C.accent}"/>
  <text x="118" y="113" font-family="${SANS}" font-size="32" font-weight="600" fill="${C.fg}">Clude</text>

  <!-- Title badge -->
  <rect x="700" y="84" width="216" height="44" rx="22" fill="${C.accentSoft}" stroke="${C.borderAccent}" stroke-opacity="0.4"/>
  <text x="808" y="112" text-anchor="middle" font-family="${MONO}" font-size="17" letter-spacing="3" fill="${C.accent}">PACK TITLE</text>

  <!-- Eyebrow -->
  <text x="84" y="318" font-family="${MONO}" font-size="20" letter-spacing="5" fill="${C.faint}">MEMORY PACK</text>

  <!-- Pack name -->
  ${nameSvg}

  <!-- Divider -->
  <rect x="84" y="540" width="832" height="1.5" fill="${C.border}"/>

  <!-- Stats -->
  <text x="84" y="654" font-family="${SANS}" font-size="92" font-weight="700" fill="${C.fg}">${count.toLocaleString('en-US')}</text>
  <text x="84" y="700" font-family="${MONO}" font-size="20" letter-spacing="4" fill="${C.muted}">MEMORIES</text>
  ${date ? `<text x="916" y="654" text-anchor="end" font-family="${SANS}" font-size="34" font-weight="600" fill="${C.fg}">${esc(date)}</text><text x="916" y="700" text-anchor="end" font-family="${MONO}" font-size="20" letter-spacing="4" fill="${C.muted}">CREATED</text>` : ''}

  <!-- 1 of 1 -->
  <text x="84" y="888" font-family="${MONO}" font-size="26" letter-spacing="2" fill="${C.accent}">1 OF 1</text>
  ${chain ? `<text x="916" y="888" text-anchor="end" font-family="${MONO}" font-size="22" fill="${C.faint}">${chain}</text>` : ''}

  <!-- Footer ids -->
  <text x="84" y="928" font-family="${MONO}" font-size="20">${footerBits.join('')}</text>
</svg>`;
}
