import type { BuyerContext, DealPhase, QuickAction } from './types'

// ─── Buyer Context ───

export const DEFAULT_BUYER_CONTEXT: BuyerContext = 'researching'

/** Widget display order per buyer context (timer is always first, handled separately). */
export const WIDGET_ORDER_BY_CONTEXT: Record<BuyerContext, string[]> = {
  researching: ['vehicle', 'numbers', 'scorecard', 'checklist'],
  reviewing_deal: ['numbers', 'scorecard', 'vehicle', 'checklist'],
  at_dealership: ['scorecard', 'numbers', 'vehicle', 'checklist'],
}

// ─── Quick Actions ───

/** Max quick action buttons shown at once. */
export const MAX_QUICK_ACTIONS = 3

/** Hide dynamic quick actions after this many AI responses without an update. */
export const QUICK_ACTIONS_STALENESS_THRESHOLD = 3

/** Hide static fallback actions after this many AI responses (no dynamic ones received yet). */
export const STATIC_ACTIONS_STALENESS_THRESHOLD = 4

/** Static fallback quick actions shown before Claude generates dynamic ones. */
export const FALLBACK_QUICK_ACTIONS: Record<BuyerContext, QuickAction[]> = {
  researching: [
    {
      label: 'Compare Prices',
      prompt: 'Help me compare prices for this car. What should I expect to pay?',
    },
    {
      label: 'New or Used?',
      prompt: 'Should I buy new or used? What are the pros and cons for my situation?',
    },
    {
      label: "What's My Budget?",
      prompt: 'Help me figure out what I can afford. What budget should I set?',
    },
  ],
  reviewing_deal: [
    { label: 'Check This Price', prompt: 'Is this price fair? Break down the numbers for me.' },
    {
      label: 'Hidden Fees?',
      prompt: 'What fees might be hidden in this deal? What should I watch for?',
    },
    { label: 'Should I Walk?', prompt: 'Based on the current deal, should I walk away?' },
  ],
  at_dealership: [
    { label: 'What Do I Say?', prompt: 'What should I say right now? Give me a script.' },
    { label: 'Should I Walk?', prompt: 'Based on the current deal, should I walk away?' },
    {
      label: "They're Pressuring Me",
      prompt: "The dealer is pressuring me. What's happening and how should I respond?",
    },
  ],
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
  listingPrice: null,
  yourTarget: null,
  walkAwayPrice: null,
  currentOffer: null,
  monthlyPayment: null,
  apr: null,
  loanTermMonths: null,
  downPayment: null,
  tradeInValue: null,
} as const

// ─── APR Thresholds ───

/** APR at or below this is considered good. */
export const APR_GOOD_THRESHOLD = 6.5

/** APR at or above this is considered bad. */
export const APR_BAD_THRESHOLD = 9

export const EMPTY_SCORECARD = {
  price: null,
  financing: null,
  tradeIn: null,
  fees: null,
  overall: null,
} as const
