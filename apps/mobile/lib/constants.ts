import type { DealPhase } from './types'

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

export const QUICK_ACTIONS = [
  { id: 'what_to_say', label: 'What Do I Say?', icon: 'MessageSquare' },
  { id: 'should_i_walk', label: 'Should I Walk?', icon: 'DoorOpen' },
  { id: 'whats_missing', label: "What Am I Forgetting?", icon: 'CircleHelp' },
] as const
