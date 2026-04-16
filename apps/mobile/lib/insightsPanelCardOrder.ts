import type { AiPanelCard } from '@/lib/types'

/**
 * Same ordering/filter as the insights panel: hide comparison/trade_off cards,
 * phase cards first, then the rest.
 */
export function orderedVisibleInsightCards(aiPanelCards: AiPanelCard[]): AiPanelCard[] {
  const visibleCards = aiPanelCards.filter(
    (card) => card.kind !== 'comparison' && card.kind !== 'trade_off'
  )
  const phaseCards = visibleCards.filter((card) => card.kind === 'phase')
  const nonPhaseCards = visibleCards.filter((card) => card.kind !== 'phase')
  return [...phaseCards, ...nonPhaseCards]
}
