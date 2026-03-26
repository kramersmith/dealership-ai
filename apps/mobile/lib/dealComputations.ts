import type { DealNumbers, HealthStatus } from './types'
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
