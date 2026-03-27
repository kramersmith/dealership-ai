import type { DealNumbers, DealState, HealthStatus } from './types'
import { APR_GOOD_THRESHOLD, APR_BAD_THRESHOLD } from './constants'

/** Tier 1: Derive basic deal health from numbers alone. */
export function computeBasicHealth(numbers: DealNumbers): HealthStatus | null {
  const { currentOffer, yourTarget, walkAwayPrice } = numbers
  if (currentOffer === null || yourTarget === null) return null
  if (currentOffer <= yourTarget) return 'good'
  if (walkAwayPrice !== null && currentOffer >= walkAwayPrice) return 'bad'
  return 'fair'
}

/** Tier 1: Total cost over loan lifetime. */
export function computeTotalLoanCost(numbers: DealNumbers): number | null {
  const { monthlyPayment, loanTermMonths } = numbers
  if (monthlyPayment === null || loanTermMonths === null) return null
  return monthlyPayment * loanTermMonths
}

/** Tier 1: Total interest paid over loan lifetime. */
export function computeTotalInterest(numbers: DealNumbers): number | null {
  const totalCost = computeTotalLoanCost(numbers)
  const { currentOffer, downPayment } = numbers
  if (totalCost === null || currentOffer === null) return null
  const principal = currentOffer - (downPayment ?? 0)
  if (principal <= 0) return null
  const interest = totalCost - principal
  return interest > 0 ? interest : null
}

/** Tier 1: APR assessment based on thresholds. */
export function assessApr(apr: number | null): 'good' | 'neutral' | 'concerning' | null {
  if (apr === null) return null
  if (apr <= APR_GOOD_THRESHOLD) return 'good'
  if (apr >= APR_BAD_THRESHOLD) return 'concerning'
  return 'neutral'
}

/** Tier 1: Trade-in net change detection.
 *  Call with previous and current numbers to detect correlated changes. */
export function computeTradeInNetChange(
  prev: DealNumbers,
  curr: DealNumbers
): { tradeInDelta: number; priceDelta: number; netChange: number } | null {
  if (
    prev.tradeInValue === null ||
    curr.tradeInValue === null ||
    prev.currentOffer === null ||
    curr.currentOffer === null
  )
    return null
  const tradeInDelta = curr.tradeInValue - prev.tradeInValue
  const priceDelta = curr.currentOffer - prev.currentOffer
  if (tradeInDelta === 0 && priceDelta === 0) return null
  return { tradeInDelta, priceDelta, netChange: tradeInDelta - priceDelta }
}

/** Tier 1: Compute savings from first offer vs. current offer. */
export function computeSavings(
  firstOffer: number | null,
  currentOffer: number | null
): number | null {
  if (firstOffer === null || currentOffer === null) return null
  const savings = firstOffer - currentOffer
  return savings > 0 ? savings : null
}

/** Tier 1: Compute F&I markup — how much add-ons have increased the deal. */
export function computeFandIMarkup(
  preFiPrice: number | null,
  currentOffer: number | null
): number | null {
  if (preFiPrice === null || currentOffer === null) return null
  const markup = currentOffer - preFiPrice
  return markup > 0 ? markup : null
}

/** Tier 1: Compute the gap between current offer and target price. */
export function computeOfferDelta(
  numbers: DealNumbers
): { amount: number; direction: 'above' | 'below' | 'at' } | null {
  const { currentOffer, yourTarget } = numbers
  if (currentOffer === null || yourTarget === null) return null
  const diff = currentOffer - yourTarget
  if (diff === 0) return { amount: 0, direction: 'at' }
  return { amount: Math.abs(diff), direction: diff > 0 ? 'above' : 'below' }
}

/** Derive a one-line "what to do next" recommendation from deal state. */
export function getNextActionRecommendation(dealState: DealState): string | null {
  const { phase, numbers, redFlags, informationGaps, preFiPrice } = dealState

  // Critical red flags take priority
  const critical = redFlags.find((f) => f.severity === 'critical')
  if (critical) return critical.message

  // F&I phase with markup
  if (phase === 'financing' && preFiPrice !== null && numbers.currentOffer !== null) {
    const markup = computeFandIMarkup(preFiPrice, numbers.currentOffer)
    if (markup !== null && markup > 0) return 'Review F&I add-ons before signing'
  }

  // Offer above target — suggest counter
  if (numbers.currentOffer !== null && numbers.yourTarget !== null) {
    if (numbers.currentOffer > numbers.yourTarget) {
      const midpoint = Math.round((numbers.currentOffer + numbers.yourTarget) / 2)
      return `Counter at $${midpoint.toLocaleString()}`
    }
    if (numbers.currentOffer <= numbers.yourTarget) {
      return 'Offer is at or below your target — review terms before accepting'
    }
  }

  // Phase-appropriate defaults
  switch (phase) {
    case 'research':
      if (dealState.vehicle)
        return 'Get pre-approved and request out-the-door quotes from multiple dealers'
      return "Share the car you're looking at to get pricing guidance"
    case 'initial_contact':
      return "Don't discuss monthly payments yet — focus on total price"
    case 'test_drive':
      return 'Note any issues — they strengthen your negotiating position'
    case 'negotiation':
      return 'Stay patient — silence is a powerful tool'
    case 'financing':
      return 'Compare every line item to your agreed price'
    case 'closing':
      return 'Read every line before signing'
    default:
      break
  }

  // Last resort: surface a high-priority information gap
  const highGap = informationGaps.find((g) => g.priority === 'high')
  if (highGap) return `Find out: ${highGap.label}`

  return null
}
