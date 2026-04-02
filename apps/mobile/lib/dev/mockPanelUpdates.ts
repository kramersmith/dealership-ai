/**
 * Dev-only utility to simulate sequential insights panel updates.
 * Pushes mock tool calls through the real dealStore pipeline so all
 * animations can be observed without hitting the LLM.
 *
 * Usage from console or a dev button:
 *   import { runMockPanelUpdates } from '@/lib/devMockPanelUpdates'
 *   runMockPanelUpdates()
 */
import { useDealStore } from '@/stores/dealStore'
import type { AiPanelCard } from '@/lib/types'

// ─── Mock Card Sets ───

// Step 1: Initial research cards
const STEP_1_INITIAL: AiPanelCard[] = [
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
const STEP_2_MINOR: AiPanelCard[] = [
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
const STEP_3_MINOR: AiPanelCard[] = [
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
const STEP_4_MAJOR: AiPanelCard[] = [
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
const STEP_5_MINOR: AiPanelCard[] = [
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
const STEP_6_MAJOR: AiPanelCard[] = [
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
const STEP_7_CLOSED: AiPanelCard[] = [
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

const MOCK_STEPS = [
  STEP_1_INITIAL, // new cards appear
  STEP_2_MINOR, // pre-approval done, checklist + briefing update
  STEP_3_MINOR, // fair price checked, risk flag added, numbers tweak
  STEP_4_MAJOR, // dealer offer — new briefing title, tip card added
  STEP_5_MINOR, // counter offer — numbers update, checklist tick
  STEP_6_MAJOR, // warning card appears, full restructure
  STEP_7_CLOSED, // deal closed — success card, full restructure
]

// ─── Runner ───

/**
 * Simulate sequential panel updates with delays between each step.
 * @param delayMs — milliseconds between each update (default 5000)
 */
export function runMockPanelUpdates(delayMs = 5000) {
  const store = useDealStore.getState()

  // Ensure a deal state exists
  if (!store.dealState) {
    store.resetDealState('mock-session', 'researching')
  }

  console.log(
    `[devMock] Starting mock panel updates (${MOCK_STEPS.length} steps, ${delayMs}ms apart)`
  )

  MOCK_STEPS.forEach((cards, i) => {
    setTimeout(() => {
      console.log(`[devMock] Step ${i + 1}/${MOCK_STEPS.length}: ${cards.length} cards`)
      useDealStore.getState().applyToolCall({
        name: 'update_insights_panel',
        args: { cards },
      })
    }, i * delayMs)
  })
}

/**
 * Clear all panel cards (reset to empty).
 */
export function clearMockPanel() {
  useDealStore.getState().applyToolCall({
    name: 'update_insights_panel',
    args: { cards: [] },
  })
  console.log('[devMock] Panel cleared')
}

// Expose globally in dev for console access
if (__DEV__) {
  ;(globalThis as any).mockPanel = runMockPanelUpdates
  ;(globalThis as any).clearPanel = clearMockPanel
}
