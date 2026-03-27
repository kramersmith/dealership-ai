import type { BuyerContext, ChecklistItem, DealPhase, QuickAction, Scorecard } from './types'

// ─── App ───

export const APP_NAME = 'DealershipAI'

/** Web font stack used in contexts where Tamagui fonts don't cascade (e.g. RN Modal). */
export const WEB_FONT_FAMILY = 'Inter, -apple-system, system-ui, sans-serif'

// ─── Buyer Context ───

export const DEFAULT_BUYER_CONTEXT: BuyerContext = 'researching'

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

// ─── Vehicle Mileage Thresholds ───

/** Mileage above this is flagged as "High Mileage". */
export const HIGH_MILEAGE_THRESHOLD = 100_000

/** Mileage above this is flagged as "Very High Miles". */
export const VERY_HIGH_MILEAGE_THRESHOLD = 150_000

// ─── Dealership Timer Thresholds (minutes) ───

/** Minutes at dealership before warning state. */
export const TIMER_WARNING_MINUTES = 60

/** Minutes at dealership before long-wait state. */
export const TIMER_LONG_MINUTES = 120

/** Contextual tips shown alongside the dealership timer at thresholds. */
export const TIMER_TIPS = {
  warning: "It's normal to wait, but track what they're 'checking on'",
  long: 'Long waits can be a pressure tactic — you can always leave and come back',
} as const

// ─── Scorecard Descriptions ───

/** One-line explanations for each scorecard category (shown on tap). */
export const SCORE_DESCRIPTIONS: Record<keyof Scorecard, string> = {
  price: 'How the offer compares to fair market value',
  financing: 'Whether the APR and loan terms are competitive',
  tradeIn: 'If your trade-in was valued fairly',
  fees: 'Whether dealer fees are reasonable and transparent',
  overall: 'Combined assessment of the entire deal',
}

// ─── Mobile Insights Panel ───

/** Fraction of screen width for the slide-out insights panel. */
export const MOBILE_INSIGHTS_WIDTH_RATIO = 0.9

/** Maximum width in pixels for the slide-out insights panel. */
export const MOBILE_INSIGHTS_MAX_WIDTH = 420

/** Maximum number of preview items shown in the compact insights bar. */
export const MAX_INSIGHTS_PREVIEW_ITEMS = 3

/** Maximum width in pixels for chat bubbles (keeps text readable on wide screens). */
export const CHAT_BUBBLE_MAX_WIDTH = 600

// ─── Post-Purchase ───

/** Default post-purchase checklist items, used as fallback when AI doesn't provide them. */
export const POST_PURCHASE_CHECKLIST: ChecklistItem[] = [
  { label: 'Title arrives within 30 days', done: false },
  { label: 'Review first loan statement — verify terms match', done: false },
  { label: 'Confirm trade-in payoff was processed', done: false },
  { label: 'Save all signed documents', done: false },
  { label: 'Check for any post-sale charges', done: false },
]
