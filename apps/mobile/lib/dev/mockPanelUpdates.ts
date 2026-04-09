/**
 * Dev-only utility to simulate sequential insights panel updates.
 * Pushes mock tool calls through the real dealStore pipeline so all
 * animations can be observed without hitting the LLM.
 *
 * Usage from console or a dev button:
 *   import { runMockPanelUpdates } from '@/lib/dev/mockPanelUpdates'
 *   runMockPanelUpdates()
 */
import { useChatStore } from '@/stores/chatStore'
import { useDealStore } from '@/stores/dealStore'
import type { AiCardKind, AiCardTemplate, AiPanelCard } from '@/lib/types'

type LegacyMockCard = Omit<AiPanelCard, 'kind' | 'template'> & { type: AiCardTemplate }

function mockKind(type: AiCardTemplate, title: string): AiCardKind {
  const normalizedTitle = title.trim().toLowerCase()

  if (type === 'vehicle') return 'vehicle'
  if (type === 'numbers') return normalizedTitle === 'price breakdown' ? 'what_changed' : 'numbers'
  if (type === 'warning')
    return normalizedTitle === 'monthly payment misdirection' ? 'if_you_say_yes' : 'warning'
  if (type === 'notes') return 'notes'
  if (type === 'comparison') return normalizedTitle === 'trade-off' ? 'trade_off' : 'comparison'
  if (type === 'checklist') {
    return normalizedTitle.includes('post-purchase') || normalizedTitle.includes('research')
      ? 'checklist'
      : 'what_still_needs_confirming'
  }
  if (type === 'success') return normalizedTitle === 'deal closed' ? 'success' : 'savings_so_far'
  if (type === 'tip') return 'your_leverage'
  return normalizedTitle.includes('offer') || normalizedTitle.includes('hold')
    ? 'next_best_move'
    : 'dealer_read'
}

function templateForMockKind(kind: AiCardKind): AiCardTemplate {
  switch (kind) {
    case 'vehicle':
      return 'vehicle'
    case 'phase':
      return 'briefing'
    case 'numbers':
    case 'what_changed':
      return 'numbers'
    case 'warning':
    case 'if_you_say_yes':
      return 'warning'
    case 'notes':
      return 'notes'
    case 'comparison':
    case 'trade_off':
      return 'comparison'
    case 'checklist':
    case 'what_still_needs_confirming':
      return 'checklist'
    case 'success':
    case 'savings_so_far':
      return 'success'
    case 'dealer_read':
    case 'next_best_move':
      return 'briefing'
    case 'your_leverage':
      return 'tip'
  }
}

function normalizeMockCard(card: LegacyMockCard): AiPanelCard {
  const kind = mockKind(card.type, card.title)
  return {
    kind,
    template: templateForMockKind(kind),
    title: card.title,
    content: card.content,
    priority: card.priority,
  }
}

// ─── Mock Card Sets ───

// Step 1: Initial research cards
const STEP_1_INITIAL: LegacyMockCard[] = [
  {
    type: 'vehicle',
    title: 'Target Vehicle',
    content: {
      vehicle: { year: 2024, make: 'Toyota', model: 'Camry', trim: 'SE' },
      risk_flags: [],
    },
    priority: 'normal',
  },
  {
    type: 'briefing',
    title: 'Getting Started',
    content: {
      body: 'Good choice on the Camry SE. Next step: get pre-approved from your bank before visiting dealers.',
    },
    priority: 'high',
  },
  {
    type: 'numbers',
    title: 'Market Pricing',
    content: {
      rows: [
        { label: 'MSRP', value: '$28,855', highlight: 'neutral' },
        { label: 'Fair Purchase Price', value: '$27,200', highlight: 'good' },
        { label: 'Dealer Invoice', value: '$26,400', highlight: 'good', secondary: true },
      ],
    },
    priority: 'normal',
  },
  {
    type: 'checklist',
    title: 'Research Checklist',
    content: {
      items: [
        { label: 'Get pre-approved financing', done: false },
        { label: 'Check KBB/Edmunds fair price', done: false },
        { label: 'Request quotes from 3 dealers', done: false },
        { label: 'Review vehicle history', done: false },
      ],
    },
    priority: 'normal',
  },
]

// Step 2: Minor update — user got pre-approved, checklist ticks + briefing tweaks
// Same card set, just content changes
const STEP_2_MINOR: LegacyMockCard[] = [
  {
    type: 'vehicle',
    title: 'Target Vehicle',
    content: {
      vehicle: { year: 2024, make: 'Toyota', model: 'Camry', trim: 'SE' },
      risk_flags: [],
    },
    priority: 'normal',
  },
  {
    type: 'briefing',
    title: 'Getting Started',
    content: {
      body: "Great — you're pre-approved at 5.2% APR. Now check KBB and Edmunds for the fair purchase price before reaching out to dealers.",
    },
    priority: 'high',
  },
  {
    type: 'numbers',
    title: 'Market Pricing',
    content: {
      rows: [
        { label: 'MSRP', value: '$28,855', highlight: 'neutral' },
        { label: 'Fair Purchase Price', value: '$27,200', highlight: 'good' },
        { label: 'Your Pre-Approval Rate', value: '5.2%', highlight: 'good' },
        { label: 'Dealer Invoice', value: '$26,400', highlight: 'good', secondary: true },
      ],
    },
    priority: 'normal',
  },
  {
    type: 'checklist',
    title: 'Research Checklist',
    content: {
      items: [
        { label: 'Get pre-approved financing', done: true },
        { label: 'Check KBB/Edmunds fair price', done: false },
        { label: 'Request quotes from 3 dealers', done: false },
        { label: 'Review vehicle history', done: false },
      ],
    },
    priority: 'normal',
  },
]

// Step 3: Another minor — checked fair price, updated numbers
const STEP_3_MINOR: LegacyMockCard[] = [
  {
    type: 'vehicle',
    title: 'Target Vehicle',
    content: {
      vehicle: { year: 2024, make: 'Toyota', model: 'Camry', trim: 'SE' },
      risk_flags: ['45 days on lot'],
    },
    priority: 'normal',
  },
  {
    type: 'briefing',
    title: 'Getting Started',
    content: {
      body: "KBB says $27,200 is fair. This one's been on the lot 45 days — that's leverage. Time to request dealer quotes.",
    },
    priority: 'high',
  },
  {
    type: 'numbers',
    title: 'Market Pricing',
    content: {
      rows: [
        { label: 'MSRP', value: '$28,855', highlight: 'neutral' },
        { label: 'Fair Purchase Price', value: '$27,200', highlight: 'good' },
        { label: 'Your Pre-Approval Rate', value: '5.2%', highlight: 'good' },
        { label: 'Days on Lot', value: '45', secondary: true },
      ],
    },
    priority: 'normal',
  },
  {
    type: 'checklist',
    title: 'Research Checklist',
    content: {
      items: [
        { label: 'Get pre-approved financing', done: true },
        { label: 'Check KBB/Edmunds fair price', done: true },
        { label: 'Request quotes from 3 dealers', done: false },
        { label: 'Review vehicle history', done: false },
      ],
    },
    priority: 'normal',
  },
]

// Step 4: Major change — dealer offer received, new card types appear
const STEP_4_MAJOR: LegacyMockCard[] = [
  {
    type: 'vehicle',
    title: 'Target Vehicle',
    content: {
      vehicle: { year: 2024, make: 'Toyota', model: 'Camry', trim: 'SE' },
      risk_flags: ['45 days on lot'],
    },
    priority: 'normal',
  },
  {
    type: 'briefing',
    title: 'Dealer Offer Received',
    content: {
      body: "They came in at $29,800 — that's $2,600 above fair market. You have leverage: this car has been on the lot 45 days.",
    },
    priority: 'high',
  },
  {
    type: 'numbers',
    title: 'Price Breakdown',
    content: {
      rows: [
        { label: 'Dealer Asking', value: '$29,800', highlight: 'bad' },
        { label: 'Fair Purchase Price', value: '$27,200', highlight: 'good' },
        { label: 'Gap', value: '$2,600', highlight: 'bad' },
        { label: 'Days on Lot', value: '45', secondary: true },
      ],
    },
    priority: 'high',
  },
  {
    type: 'tip',
    title: 'Lot Time Leverage',
    content: {
      body: "A car sitting 45+ days costs the dealer ~$30/day in floor plan interest. They're motivated to move it.",
    },
    priority: 'normal',
  },
  {
    type: 'checklist',
    title: 'Research Checklist',
    content: {
      items: [
        { label: 'Get pre-approved financing', done: true },
        { label: 'Check KBB/Edmunds fair price', done: true },
        { label: 'Request quotes from 3 dealers', done: true },
        { label: 'Review vehicle history', done: false },
      ],
    },
    priority: 'normal',
  },
]

// Step 5: Minor — counter offer, numbers update
const STEP_5_MINOR: LegacyMockCard[] = [
  {
    type: 'vehicle',
    title: 'Target Vehicle',
    content: {
      vehicle: { year: 2024, make: 'Toyota', model: 'Camry', trim: 'SE' },
      risk_flags: ['45 days on lot'],
    },
    priority: 'normal',
  },
  {
    type: 'briefing',
    title: 'Dealer Offer Received',
    content: {
      body: "You countered at $27,500. They came back at $29,200 — gap is narrowing. Hold firm, you're in a strong position.",
    },
    priority: 'high',
  },
  {
    type: 'numbers',
    title: 'Price Breakdown',
    content: {
      rows: [
        { label: 'Your Offer', value: '$27,500', highlight: 'good' },
        { label: 'Their Counter', value: '$29,200', highlight: 'bad' },
        { label: 'Gap', value: '$1,700', highlight: 'bad' },
        { label: 'Fair Purchase Price', value: '$27,200', highlight: 'good', secondary: true },
      ],
    },
    priority: 'high',
  },
  {
    type: 'tip',
    title: 'Lot Time Leverage',
    content: {
      body: "A car sitting 45+ days costs the dealer ~$30/day in floor plan interest. They're motivated to move it.",
    },
    priority: 'normal',
  },
  {
    type: 'checklist',
    title: 'Research Checklist',
    content: {
      items: [
        { label: 'Get pre-approved financing', done: true },
        { label: 'Check KBB/Edmunds fair price', done: true },
        { label: 'Request quotes from 3 dealers', done: true },
        { label: 'Review vehicle history', done: true },
      ],
    },
    priority: 'normal',
  },
]

// Step 6: Major — warning card appears, negotiation escalation
const STEP_6_MAJOR: LegacyMockCard[] = [
  {
    type: 'warning',
    title: 'Monthly Payment Misdirection',
    content: {
      severity: 'warning',
      message:
        'Dealer switched from total price to monthly payment. They may be stretching the term to hide the real cost.',
      action: "Redirect: 'What's the out-the-door price? I'll worry about monthly later.'",
    },
    priority: 'critical',
  },
  {
    type: 'vehicle',
    title: 'Target Vehicle',
    content: {
      vehicle: { year: 2024, make: 'Toyota', model: 'Camry', trim: 'SE' },
      risk_flags: ['45 days on lot'],
    },
    priority: 'normal',
  },
  {
    type: 'briefing',
    title: 'Hold at $27,500',
    content: {
      body: 'Their counter of $29,200 is still $1,700 above your target. Stand firm — you have the pre-approval and competing quotes.',
    },
    priority: 'high',
  },
  {
    type: 'numbers',
    title: 'Negotiation Status',
    content: {
      rows: [
        { label: 'Your Offer', value: '$27,500', highlight: 'good' },
        { label: 'Their Counter', value: '$29,200', highlight: 'bad' },
        { label: 'Gap', value: '$1,700', highlight: 'bad' },
        { label: 'Your Target', value: '$27,200', highlight: 'good', secondary: true },
      ],
    },
    priority: 'high',
  },
  {
    type: 'checklist',
    title: 'Negotiation Checklist',
    content: {
      items: [
        { label: 'Get pre-approved financing', done: true },
        { label: 'Check KBB/Edmunds fair price', done: true },
        { label: 'Request quotes from 3 dealers', done: true },
        { label: 'Review vehicle history', done: true },
        { label: 'Get out-the-door price in writing', done: false },
      ],
    },
    priority: 'normal',
  },
]

// Step 7: Major — deal closed
const STEP_7_CLOSED: LegacyMockCard[] = [
  {
    type: 'success',
    title: 'Deal Closed',
    content: {
      body: 'You saved an estimated **$1,855** compared to the initial asking price. Well done.',
    },
    priority: 'high',
  },
  {
    type: 'vehicle',
    title: 'Target Vehicle',
    content: {
      vehicle: { year: 2024, make: 'Toyota', model: 'Camry', trim: 'SE' },
      risk_flags: [],
    },
    priority: 'normal',
  },
  {
    type: 'numbers',
    title: 'Final Numbers',
    content: {
      rows: [
        { label: 'Purchase Price', value: '$27,000', highlight: 'good' },
        { label: 'Original Ask', value: '$29,800', highlight: 'neutral', secondary: true },
        { label: 'You Saved', value: '$1,855', highlight: 'good' },
      ],
    },
    priority: 'normal',
  },
  {
    type: 'checklist',
    title: 'Post-Purchase',
    content: {
      items: [
        { label: 'Verify all paperwork matches agreed terms', done: false },
        { label: "Check for added products you didn't request", done: false },
        { label: 'Get copies of all signed documents', done: false },
      ],
    },
    priority: 'normal',
  },
]

const MOCK_STEPS: AiPanelCard[][] = [
  STEP_1_INITIAL.map(normalizeMockCard),
  STEP_2_MINOR.map(normalizeMockCard),
  STEP_3_MINOR.map(normalizeMockCard),
  STEP_4_MAJOR.map(normalizeMockCard),
  STEP_5_MINOR.map(normalizeMockCard),
  STEP_6_MAJOR.map(normalizeMockCard),
  STEP_7_CLOSED.map(normalizeMockCard),
]

function bumpInsightsPanelCommitGeneration() {
  useChatStore.setState((state) => ({
    insightsPanelCommitGeneration: state.insightsPanelCommitGeneration + 1,
  }))
}

function setMockPanelAnalyzing(isAnalyzing: boolean) {
  useChatStore.setState({ isPanelAnalyzing: isAnalyzing })
}

function applyMockPanelCards(cards: AiPanelCard[]) {
  // Bump commit gen before deal so InsightsPanel never renders new cards with gen still 0
  // (that path syncs the snapshot and skips the strip animation).
  bumpInsightsPanelCommitGeneration()
  useDealStore.getState().applyToolCall({
    name: 'update_insights_panel',
    args: { cards },
  })
}

// ─── Runner ───

/**
 * Simulate sequential panel updates with delays between each step.
 * @param delayMs — milliseconds between each update (default 5000)
 * @param analyzeMs — milliseconds to show "analyzing" before each commit
 */
export function runMockPanelUpdates(delayMs = 5000, analyzeMs?: number) {
  const store = useDealStore.getState()
  const analysisLeadMs = Math.max(
    350,
    Math.min(analyzeMs ?? Math.round(delayMs * 0.3), Math.max(350, delayMs - 120))
  )

  // Ensure a deal state exists
  if (!store.dealState) {
    store.resetDealState('mock-session', 'researching')
  }

  console.log(
    `[devMock] Starting mock panel updates (${MOCK_STEPS.length} steps, ${delayMs}ms apart, analyze=${analysisLeadMs}ms)`
  )

  MOCK_STEPS.forEach((cards, i) => {
    setTimeout(() => {
      setMockPanelAnalyzing(true)
    }, i * delayMs)

    setTimeout(
      () => {
        console.log(`[devMock] Step ${i + 1}/${MOCK_STEPS.length}: ${cards.length} cards`)
        applyMockPanelCards(cards)
        setMockPanelAnalyzing(false)
      },
      i * delayMs + analysisLeadMs
    )
  })
}

/**
 * Clear all panel cards (reset to empty).
 */
export function clearMockPanel() {
  setMockPanelAnalyzing(false)
  applyMockPanelCards([])
  console.log('[devMock] Panel cleared')
}

// Expose globally in dev for console access
if (__DEV__) {
  ;(globalThis as any).mockPanel = runMockPanelUpdates
  ;(globalThis as any).clearPanel = clearMockPanel
}
