import { describe, expect, it } from 'vitest'
import {
  getCollapsedPrimaryHeadline,
  getDedupedPanelIconKinds,
  getInsightsPreviewItems,
  INSIGHTS_PREVIEW_COMPACT_WITH_PANEL,
  INSIGHTS_PREVIEW_EMPTY_COPY,
} from '@/lib/insightsCollapsedPreview'
import type { AiPanelCard, DealState } from '@/lib/types'

function minimalDeal(overrides: Partial<DealState> = {}): DealState {
  return {
    sessionId: 's1',
    buyerContext: 'researching',
    activeDealId: 'd1',
    vehicles: [],
    deals: [
      {
        id: 'd1',
        vehicleId: 'v1',
        dealerName: null,
        phase: 'research',
        numbers: {
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
        },
        health: null,
        savingsEstimate: null,
        firstOffer: null,
        preFiPrice: null,
        redFlags: [],
        informationGaps: [],
        scorecard: {
          price: null,
          financing: null,
          tradeIn: null,
          fees: null,
          overall: null,
        },
      },
    ],
    redFlags: [],
    informationGaps: [],
    checklist: [],
    timerStartedAt: null,
    negotiationContext: null,
    aiPanelCards: [],
    dealComparison: null,
    ...overrides,
  } as DealState
}

describe('getInsightsPreviewItems', () => {
  it('uses contextual empty copy for researching when no signals', () => {
    const items = getInsightsPreviewItems(minimalDeal(), new Set(), 'researching')
    expect(items).toEqual([{ type: 'text', label: INSIGHTS_PREVIEW_EMPTY_COPY.researching }])
  })

  it('prioritizes critical flag before multi-deal text', () => {
    const d0 = minimalDeal().deals[0]
    const deal = minimalDeal({
      deals: [
        { ...d0, id: 'd1' },
        { ...d0, id: 'd2' },
      ],
      redFlags: [{ id: 'f1', severity: 'critical', message: 'Bad fee structure' }],
    })
    const items = getInsightsPreviewItems(deal, new Set(), 'researching')
    expect(items[0]).toEqual({ type: 'flag', label: 'Bad fee structure' })
  })

  it('uses phase situation as preview text when present', () => {
    const cards: AiPanelCard[] = [
      {
        kind: 'phase',
        template: 'briefing',
        title: 'Status',
        priority: 'normal',
        content: { stance: 'researching', situation: 'Comparing two SUVs' },
      },
    ]
    const items = getInsightsPreviewItems(
      minimalDeal({ aiPanelCards: cards }),
      new Set(),
      'researching'
    )
    expect(items[0]).toEqual({ type: 'text', label: 'Comparing two SUVs' })
  })

  it('uses compact headline when panel has kinds but no scrapable fields', () => {
    const cards: AiPanelCard[] = [
      {
        kind: 'vehicle',
        template: 'vehicle',
        title: 'V1',
        priority: 'normal',
        content: {},
      },
    ]
    const items = getInsightsPreviewItems(
      minimalDeal({ aiPanelCards: cards }),
      new Set(),
      'researching'
    )
    expect(items[0]).toEqual({
      type: 'text',
      label: INSIGHTS_PREVIEW_COMPACT_WITH_PANEL.researching,
    })
  })
})

describe('getCollapsedPrimaryHeadline', () => {
  it('uses first panel snippet when only contextual empty would show', () => {
    const cards: AiPanelCard[] = [
      {
        kind: 'next_best_move',
        template: 'tip',
        title: 'Tip',
        priority: 'normal',
        content: { headline: 'Ask for the out-the-door total' },
      },
    ]
    const headline = getCollapsedPrimaryHeadline(
      minimalDeal({ aiPanelCards: cards }),
      new Set(),
      'researching'
    )
    expect(headline).toBe('Ask for the out-the-door total')
  })
})

describe('getDedupedPanelIconKinds', () => {
  it('filters comparison/trade_off and dedupes kinds in panel order', () => {
    const cards: AiPanelCard[] = [
      {
        kind: 'phase',
        template: 'briefing',
        title: 'Status',
        priority: 'normal',
        content: { stance: 'researching', situation: 'Comparing two SUVs' },
      },
      {
        kind: 'vehicle',
        template: 'vehicle',
        title: 'V1',
        priority: 'normal',
        content: {},
      },
      {
        kind: 'vehicle',
        template: 'vehicle',
        title: 'V2',
        priority: 'normal',
        content: {},
      },
      { kind: 'comparison', template: 'comparison', title: 'X', priority: 'low', content: {} },
      { kind: 'numbers', template: 'numbers', title: 'N', priority: 'normal', content: {} },
    ]
    expect(getDedupedPanelIconKinds(cards)).toEqual(['phase', 'vehicle', 'numbers'])
  })
})
