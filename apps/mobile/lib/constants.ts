import type { BuyerContext, DealPhase } from './types'

// ─── Buyer Context ───

export const DEFAULT_BUYER_CONTEXT: BuyerContext = 'researching'

/** Widget display order per buyer context (timer is always first, handled separately). */
export const WIDGET_ORDER_BY_CONTEXT: Record<BuyerContext, string[]> = {
  researching: ['vehicle', 'numbers', 'scorecard', 'checklist'],
  reviewing_deal: ['numbers', 'scorecard', 'vehicle', 'checklist'],
  at_dealership: ['scorecard', 'numbers', 'vehicle', 'checklist'],
}

export const DEAL_PHASES: { key: DealPhase; label: string }[] = [
  { key: 'research', label: 'Research' },
  { key: 'initial_contact', label: 'At Dealer' },
  { key: 'test_drive', label: 'Test Drive' },
  { key: 'negotiation', label: 'Negotiating' },
  { key: 'financing', label: 'F&I' },
  { key: 'closing', label: 'Signing' },
]

export const SCORE_COLORS = {
  red: '#EF4444',
  yellow: '#EAB308',
  green: '#22C55E',
} as const

export const EMPTY_DEAL_NUMBERS = {
  msrp: null,
  invoicePrice: null,
  theirOffer: null,
  yourTarget: null,
  walkAwayPrice: null,
  currentOffer: null,
  monthlyPayment: null,
  apr: null,
  loanTermMonths: null,
  downPayment: null,
  tradeInValue: null,
} as const

export const EMPTY_SCORECARD = {
  price: null,
  financing: null,
  tradeIn: null,
  fees: null,
  overall: null,
} as const
