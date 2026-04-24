import type { DealRecapPublicBeat, DealRecapSavingsSnapshot } from '@/lib/types'
import { buildRecapSavingsGlance } from '@/lib/recapSavingsNarrative'

export type RecapPdfVariant = 'timeline' | 'savings' | 'full'

/** Aligned with `palette` / dark recap UI (cards, brand strip, tiles). */
const C = {
  pageBg: '#0b0c0e',
  cardBg: '#121418',
  cardBorder: '#2c3139',
  text: '#f2f3f5',
  muted: '#9ca3af',
  faint: '#6b7280',
  brand: '#2d88ff',
  brandSubtle: '#263240',
  hairline: '#2c3139',
  tileBg: '#1a2028',
} as const

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatMoneyUsd(value: number): string {
  return `$${Math.round(value).toLocaleString()}`
}

function formatApr(aprPercent: number): string {
  const digits = aprPercent >= 10 ? 2 : 3
  return `${aprPercent.toFixed(digits)}%`
}

function savingsTiles(s: DealRecapSavingsSnapshot): { label: string; value: string }[] {
  const tiles: { label: string; value: string }[] = []
  if (s.firstOffer != null) tiles.push({ label: 'First offer', value: formatMoneyUsd(s.firstOffer) })
  if (s.currentOffer != null) tiles.push({ label: 'Current offer', value: formatMoneyUsd(s.currentOffer) })
  if (s.concessionVsFirstOffer != null) {
    tiles.push({ label: 'Concession vs first offer', value: formatMoneyUsd(s.concessionVsFirstOffer) })
  }
  if (s.monthlyPayment != null) tiles.push({ label: 'Monthly payment', value: formatMoneyUsd(s.monthlyPayment) })
  if (s.aprPercent != null) tiles.push({ label: 'APR', value: formatApr(s.aprPercent) })
  if (s.loanTermMonths != null) tiles.push({ label: 'Loan term', value: `${s.loanTermMonths} mo` })
  if (s.estimatedTotalInterestDeltaUsd != null) {
    tiles.push({
      label: 'Interest vs +1% APR (est.)',
      value: formatMoneyUsd(s.estimatedTotalInterestDeltaUsd),
    })
  }
  return tiles
}

function formatBeatWhen(iso: string | null | undefined): string {
  if (iso == null || iso === '') return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return d.toLocaleString(undefined, opts)
}

function appStripHtml(app: string): string {
  const t = escapeHtml(app.trim())
  if (!t) return ''
  return `<div class="app-strip"><span class="app-strip-icon" aria-hidden="true">✦</span><p class="app-strip-text">${t}</p></div>`
}

function beatCardHtml(b: DealRecapPublicBeat): string {
  const when = formatBeatWhen(b.occurredAt)
  const world = b.world.trim()
  const app = b.app.trim()
  const parts: string[] = []
  if (when) parts.push(`<div class="beat-when">${escapeHtml(when)}</div>`)

  if (!world && app) {
    parts.push(appStripHtml(app))
  } else {
    if (world) parts.push(`<div class="beat-world">${escapeHtml(world)}</div>`)
    if (app) {
      if (world) parts.push('<div class="hairline" role="presentation"></div>')
      parts.push(appStripHtml(app))
    }
  }
  if (parts.length === 0) parts.push('<p class="muted">(empty beat)</p>')
  return `<article class="beat-card">${parts.join('')}</article>`
}

function beatsSectionHtml(beats: DealRecapPublicBeat[]): string {
  if (beats.length === 0) {
    return '<p class="muted beats-stack">No timeline events in this export.</p>'
  }
  return `<div class="beats-stack">${beats.map((b) => beatCardHtml(b)).join('')}</div>`
}

function savingsGlanceHtml(s: DealRecapSavingsSnapshot): string {
  const g = buildRecapSavingsGlance(s)
  if (!g.hasAny) return ''
  const lines: string[] = []
  if (g.headline) lines.push(`<p class="glance-line">${escapeHtml(g.headline)}</p>`)
  if (g.bridge) lines.push(`<p class="glance-line muted">${escapeHtml(g.bridge)}</p>`)
  if (g.interest) lines.push(`<p class="glance-line">${escapeHtml(g.interest)}</p>`)
  return `<div class="glance-box"><div class="glance-kicker">Your deal in one glance</div>${lines.join('')}</div>`
}

function savingsSectionHtml(s: DealRecapSavingsSnapshot): string {
  const glance = savingsGlanceHtml(s)
  const tiles = savingsTiles(s)
  const assumptions =
    s.assumptions.length > 0
      ? `<div class="assumptions"><div class="section-kicker">How we calculated this</div><ul class="assumptions-list">${s.assumptions
          .map((line) => `<li><span class="bullet">•</span><span>${escapeHtml(line)}</span></li>`)
          .join('')}</ul></div>`
      : ''

  let tilesHtml = ''
  if (tiles.length > 0) {
    tilesHtml = `<div class="tiles-grid">${tiles
      .map(
        (t) =>
          `<div class="tile"><div class="tile-label">${escapeHtml(t.label)}</div><div class="tile-value">${escapeHtml(t.value)}</div></div>`
      )
      .join('')}</div>`
  }

  const disclaimer = s.disclaimer.trim()
    ? `<p class="disclaimer">${escapeHtml(s.disclaimer)}</p>`
    : ''

  if (!tilesHtml && !assumptions && !disclaimer) {
    return '<p class="muted">No offer or financing numbers in this export.</p>'
  }

  return `${glance}${tilesHtml}${assumptions}${disclaimer}`
}

/** Tries one tall print sheet so “Save as PDF” splits less; capped for very long exports. */
const PRINT_PAGE_SCRIPT = `
<script>
(function () {
  function inchFromPx(px) {
    return Math.ceil((px / 96) * 100) / 100;
  }
  function applyTallPage() {
    try {
      var prev = document.querySelector('style[data-recap-print-page]');
      if (prev) prev.remove();
      var h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      var marginIn = 0.4;
      var bodyH = h + marginIn * 96 * 2;
      var hIn = Math.min(144, Math.max(11, inchFromPx(bodyH)));
      var wIn = 8.5;
      var s = document.createElement('style');
      s.setAttribute('data-recap-print-page', '1');
      s.textContent =
        '@media print { @page { size: ' +
        wIn +
        'in ' +
        hIn +
        'in; margin: ' +
        marginIn +
        'in; } html, body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }';
      document.head.appendChild(s);
    } catch (e) {}
  }
  if (document.readyState === 'complete') applyTallPage();
  else window.addEventListener('load', applyTallPage);
})();
</script>
`

const PDF_STYLES = `
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: ${C.pageBg};
    color: ${C.text};
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 16px;
    line-height: 1.45;
    -webkit-font-smoothing: antialiased;
  }
  .recap-export {
    max-width: 800px;
    margin: 0 auto;
    padding: 20px 18px 32px;
    background: ${C.pageBg};
  }
  .doc-title {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin: 0 0 6px;
    color: ${C.text};
  }
  .doc-sub {
    font-size: 13px;
    line-height: 20px;
    color: ${C.faint};
    margin: 0 0 22px;
  }
  .section-kicker {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: ${C.faint};
    margin: 0 0 8px;
  }
  .section-head {
    font-size: 16px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: ${C.text};
    margin: 28px 0 12px;
  }
  .section-head:first-of-type { margin-top: 8px; }
  .beats-stack { margin-top: 10px; }
  .muted { color: ${C.muted}; font-size: 14px; line-height: 22px; margin: 0; }
  .beat-card {
    background: ${C.cardBg};
    border: 1px solid ${C.cardBorder};
    border-radius: 12px;
    padding: 12px;
    margin-bottom: 10px;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .beat-when {
    font-size: 13px;
    line-height: 18px;
    color: ${C.muted};
    margin-bottom: 10px;
  }
  .beat-world {
    font-size: 16px;
    line-height: 24px;
    color: ${C.text};
    margin: 0;
  }
  .hairline {
    height: 1px;
    width: 100%;
    background: ${C.hairline};
    margin: 10px 0;
  }
  .app-strip {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    gap: 10px;
    padding: 10px;
    border-radius: 8px;
    background: ${C.brandSubtle};
    border-left: 3px solid ${C.brand};
    margin-top: 0;
  }
  .app-strip-icon {
    flex-shrink: 0;
    font-size: 18px;
    line-height: 24px;
    color: ${C.brand};
    margin-top: 1px;
  }
  .app-strip-text {
    flex: 1;
    margin: 0;
    font-size: 16px;
    line-height: 24px;
    color: ${C.text};
    min-width: 0;
  }
  .tiles-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 12px;
  }
  @media (max-width: 520px) {
    .tiles-grid { grid-template-columns: 1fr; }
  }
  .tile {
    background: ${C.tileBg};
    border: 1px solid ${C.cardBorder};
    border-radius: 10px;
    padding: 12px;
    min-width: 0;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .tile-label {
    font-size: 12px;
    font-weight: 600;
    color: ${C.muted};
    line-height: 16px;
  }
  .tile-value {
    font-size: 22px;
    font-weight: 700;
    color: ${C.text};
    margin-top: 4px;
    line-height: 28px;
  }
  .assumptions { margin-top: 14px; }
  .assumptions-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .assumptions-list li {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    margin-top: 8px;
    font-size: 13px;
    line-height: 21px;
    color: ${C.text};
  }
  .assumptions-list .bullet {
    flex-shrink: 0;
    width: 16px;
    text-align: center;
    color: ${C.muted};
    padding-top: 1px;
  }
  .disclaimer {
    margin-top: 14px;
    font-size: 13px;
    line-height: 20px;
    color: ${C.muted};
  }
  .glance-box {
    margin-top: 0;
    margin-bottom: 14px;
    padding: 14px 14px 14px 16px;
    border-radius: 12px;
    background: ${C.brandSubtle};
    border: 1px solid ${C.cardBorder};
    border-left: 4px solid ${C.brand};
  }
  .glance-kicker {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: ${C.brand};
    margin: 0 0 10px;
  }
  .glance-line {
    margin: 0 0 8px;
    font-size: 15px;
    line-height: 24px;
    color: ${C.text};
  }
  .glance-line:last-child { margin-bottom: 0; }
  @media print {
    html, body { background: ${C.pageBg} !important; }
    .recap-export { padding: 0; max-width: none; }
    .beat-card, .tile, .app-strip { break-inside: avoid; page-break-inside: avoid; }
  }
`

/** Full HTML document for expo-print / browser print / html2canvas (share-safe recap payload). */
export function buildDealRecapPdfHtml(opts: {
  variant: RecapPdfVariant
  beats: DealRecapPublicBeat[]
  savings: DealRecapSavingsSnapshot
  title?: string
}): string {
  const { variant, beats, savings } = opts
  const docTitle = escapeHtml(opts.title ?? 'Deal recap')

  let bodyInner = ''
  if (variant === 'timeline') {
    bodyInner = `<div class="section-kicker">Your timeline</div>${beatsSectionHtml(beats)}`
  } else if (variant === 'savings') {
    bodyInner = `<div class="section-kicker">Deal numbers</div><h2 class="section-head">Savings snapshot</h2><p class="muted" style="margin-bottom:14px">From deal numbers in chat; illustrative where noted (same math as the app recap).</p>${savingsSectionHtml(savings)}`
  } else {
    bodyInner = `<div class="section-kicker">Your timeline</div>${beatsSectionHtml(beats)}<div class="section-kicker" style="margin-top:20px">Deal numbers</div><h2 class="section-head">Savings snapshot</h2><p class="muted" style="margin-bottom:14px">From deal numbers in chat; illustrative where noted (same math as the app recap).</p>${savingsSectionHtml(savings)}`
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${docTitle}</title>
  <style>${PDF_STYLES}</style>
</head>
<body class="recap-export">
  <h1 class="doc-title">${docTitle}</h1>
  <p class="doc-sub">Dealership AI — share-safe export. Figures are illustrative where noted.</p>
  ${bodyInner}
  ${PRINT_PAGE_SCRIPT}
</body>
</html>`
}
