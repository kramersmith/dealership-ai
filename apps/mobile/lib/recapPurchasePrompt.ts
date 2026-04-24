/**
 * Heuristics for when to nudge the buyer toward generating a deal recap timeline.
 * Conservative: prefer a few clear purchase-complete phrases over broad matching.
 */

const PURCHASE_COMPLETE_PATTERNS: RegExp[] = [
  /\bbought\s+the\s+(truck|car|vehicle|suv)\b/i,
  /\bbought\s+it\b/i,
  /\b(i|we)\s+bought\s+the\s+(truck|car|vehicle|suv)\b/i,
  /\b(i|we)\s+bought\s+it\b/i,
  /\bpurchased\s+the\s+(truck|car|vehicle|suv)\b/i,
  /\bpicked\s+up\s+the\s+(truck|car|vehicle|suv)\b/i,
  /\bpicked\s+it\s+up\b/i,
  /\btook\s+delivery\b/i,
  /\bsigned\s+(the\s+)?(papers|deal)\b/i,
  /\bdeal\s+is\s+done\b/i,
  /\bconfirm(?:ing|ed)?\b.*\bbought\b/i,
  /\b(i|we)\s+got\s+the\s+(truck|car|vehicle|suv)\b/i,
  /\bclosing\s+today\b.*\bbought\b/i,
]

/**
 * Returns true when the buyer's message text suggests they completed a purchase.
 */
export function userMessageSuggestsPurchaseComplete(text: string): boolean {
  const t = text.trim()
  if (t.length < 8) return false
  return PURCHASE_COMPLETE_PATTERNS.some((re) => re.test(t))
}

/** Deal phase where a recap nudge is appropriate. */
export function dealPhaseSuggestsRecapTimeline(phase: string | null | undefined): boolean {
  return phase === 'closing'
}
