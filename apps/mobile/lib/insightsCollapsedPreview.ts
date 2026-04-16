import { formatCurrency, getActiveDeal } from '@/lib/utils'
import { computeBasicHealth, computeSavings } from '@/lib/dealComputations'
import { STATUS_LABELS } from '@/lib/constants'
import type { AiCardKind, AiPanelCard, BuyerContext, DealState, HealthStatus } from '@/lib/types'
import { orderedVisibleInsightCards } from '@/lib/insightsPanelCardOrder'

/** Contextual empty state when no deal signals are available yet. */
export const INSIGHTS_PREVIEW_EMPTY_COPY: Record<BuyerContext, string> = {
  researching: 'Insights will fill in as you compare vehicles and prices',
  reviewing_deal: 'Add deal numbers to unlock pricing, risks, and next steps',
  at_dealership: 'Open insights for red flags, leverage, and what to say next',
}

/**
 * Short text line when the panel has cards (icons show breadth) but there is no
 * deal-level signal and no scrapable snippet — avoids duplicating a long empty-state
 * sentence next to the icon strip.
 */
export const INSIGHTS_PREVIEW_COMPACT_WITH_PANEL: Record<BuyerContext, string> = {
  researching: 'Vehicles & pricing',
  reviewing_deal: 'Numbers & risks',
  at_dealership: 'Leverage & scripts',
}

export type InsightsPreviewItem =
  | { type: 'health'; status: HealthStatus }
  | { type: 'text'; label: string }
  | { type: 'flag'; label: string }
  | { type: 'savings'; label: string }
  | { type: 'flagCount'; count: number }

const HEADLINE_MAX_LEN = 96

function truncateHeadline(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= HEADLINE_MAX_LEN) return trimmed
  return `${trimmed.slice(0, HEADLINE_MAX_LEN - 1)}…`
}

function scrapeFirstPanelSnippet(cards: AiPanelCard[]): string {
  for (const card of cards) {
    if (!card) continue
    const { content } = card
    if (!content || typeof content !== 'object') continue
    const candidateKeys = [
      'summary',
      'headline',
      'message',
      'recommendation',
      'situation',
      'label',
      'value',
      'status',
      'title',
    ] as const
    for (const key of candidateKeys) {
      const value = (content as Record<string, unknown>)[key]
      if (typeof value === 'string' && value.trim()) {
        return truncateHeadline(value.trim())
      }
    }
  }
  return ''
}

function emptyCopyFor(buyerContext: BuyerContext): string {
  return INSIGHTS_PREVIEW_EMPTY_COPY[buyerContext] ?? INSIGHTS_PREVIEW_EMPTY_COPY.researching
}

function compactWithPanelCopy(buyerContext: BuyerContext): string {
  return (
    INSIGHTS_PREVIEW_COMPACT_WITH_PANEL[buyerContext] ??
    INSIGHTS_PREVIEW_COMPACT_WITH_PANEL.researching
  )
}

/**
 * Deduped panel card kinds in panel-visible order (for icon strip).
 */
export function getDedupedPanelIconKinds(
  aiPanelCards: AiPanelCard[] | null | undefined
): AiCardKind[] {
  const ordered = orderedVisibleInsightCards(aiPanelCards ?? [])
  const seen = new Set<string>()
  const out: AiCardKind[] = []
  for (const card of ordered) {
    if (seen.has(card.kind)) continue
    seen.add(card.kind)
    out.push(card.kind)
  }
  return out
}

/**
 * Prioritized preview rows for the mobile collapsed insights strip.
 * Order matches product spec: risk and health before breadth (e.g. multi-deal).
 */
export function getInsightsPreviewItems(
  dealState: DealState | null,
  dismissedFlagIds: Set<string>,
  buyerContext: BuyerContext
): InsightsPreviewItem[] {
  if (!dealState) {
    return [{ type: 'text', label: emptyCopyFor(buyerContext) }]
  }

  const ctx = dealState.buyerContext ?? buyerContext
  const activeDeal = getActiveDeal(dealState)
  const items: InsightsPreviewItem[] = []
  const allFlags = [...(activeDeal?.redFlags ?? []), ...dealState.redFlags]

  const criticalFlag = allFlags.find(
    (flag) => flag.severity === 'critical' && !dismissedFlagIds.has(flag.id)
  )
  if (criticalFlag) {
    items.push({ type: 'flag', label: criticalFlag.message })
  }

  const numbers = activeDeal?.numbers
  const healthStatus = activeDeal?.health?.status ?? (numbers ? computeBasicHealth(numbers) : null)
  if (healthStatus) {
    items.push({ type: 'health', status: healthStatus })
  }

  if (numbers?.currentOffer != null) {
    items.push({ type: 'text', label: formatCurrency(numbers.currentOffer) })
  } else if (numbers?.listingPrice != null) {
    items.push({ type: 'text', label: `List ${formatCurrency(numbers.listingPrice)}` })
  }

  if (activeDeal) {
    const savings =
      activeDeal.savingsEstimate ??
      computeSavings(activeDeal.firstOffer, activeDeal.numbers.currentOffer)
    if (savings != null && savings > 0) {
      items.push({ type: 'savings', label: `Saved ${formatCurrency(savings)}` })
    }
  }

  const warningCount = allFlags.filter(
    (flag) => flag.severity === 'warning' && !dismissedFlagIds.has(flag.id)
  ).length
  if (warningCount > 0 && !criticalFlag) {
    items.push({ type: 'flagCount', count: warningCount })
  }

  if (dealState.timerStartedAt) {
    items.push({ type: 'text', label: 'Timer running' })
  }

  if (dealState.deals.length >= 2) {
    items.push({ type: 'text', label: `${dealState.deals.length} deals` })
  }

  if (items.length === 0) {
    const cards = dealState.aiPanelCards ?? []
    const scraped = scrapeFirstPanelSnippet(cards)
    const kinds = getDedupedPanelIconKinds(cards)
    if (scraped) {
      items.push({ type: 'text', label: scraped })
    } else if (kinds.length > 0) {
      items.push({ type: 'text', label: compactWithPanelCopy(ctx) })
    } else {
      items.push({ type: 'text', label: emptyCopyFor(ctx) })
    }
  }

  return items
}

function firstPreviewItemHeadline(item: InsightsPreviewItem): string {
  switch (item.type) {
    case 'health':
      return STATUS_LABELS[item.status]
    case 'flag':
      return truncateHeadline(item.label)
    case 'savings':
    case 'text':
      return truncateHeadline(item.label)
    case 'flagCount':
      return `${item.count} warning${item.count === 1 ? '' : 's'}`
    default:
      return ''
  }
}

/**
 * Single headline for the desktop dock — same priority chain as
 * {@link getInsightsPreviewItems}, returning the first item as a string.
 */
export function getCollapsedPrimaryHeadline(
  dealState: DealState | null,
  dismissedFlagIds: Set<string>,
  buyerContext: BuyerContext
): string {
  const items = getInsightsPreviewItems(dealState, dismissedFlagIds, buyerContext)
  return firstPreviewItemHeadline(items[0])
}
