import type { DealRecapSavingsSnapshot } from '@/lib/types'

export function formatRecapSavingsMoney(value: number): string {
  return `$${Math.round(value).toLocaleString()}`
}

export type RecapSavingsGlance = {
  hasAny: boolean
  headline: string | null
  bridge: string | null
  interest: string | null
}

/** Short “business story” lines above the metric tiles (same inputs as server `savings_math`). */
export function buildRecapSavingsGlance(s: DealRecapSavingsSnapshot): RecapSavingsGlance {
  const fo = s.firstOffer
  const co = s.currentOffer
  const con = s.concessionVsFirstOffer
  const intDelta = s.estimatedTotalInterestDeltaUsd

  let bridge: string | null = null
  if (fo != null && co != null) {
    bridge = `First documented offer ${formatRecapSavingsMoney(fo)} → now ${formatRecapSavingsMoney(co)}.`
  } else if (fo != null) {
    bridge = `First documented offer ${formatRecapSavingsMoney(fo)}.`
  } else if (co != null) {
    bridge = `Current offer on file: ${formatRecapSavingsMoney(co)}.`
  }

  let headline: string | null = null
  if (con != null) {
    headline = `You’re about ${formatRecapSavingsMoney(con)} better off on the vehicle than that first documented offer.`
  } else if (fo != null && co != null) {
    headline = `Price on the table: ${formatRecapSavingsMoney(fo)} when first recorded, ${formatRecapSavingsMoney(co)} now.`
  }

  let interest: string | null = null
  if (intDelta != null) {
    interest = `At this loan shape, about ${formatRecapSavingsMoney(intDelta)} less total interest than the same loan at one percentage point higher APR (illustrative).`
  }

  const hasAny = headline != null || bridge != null || interest != null
  return { hasAny, headline, bridge, interest }
}
