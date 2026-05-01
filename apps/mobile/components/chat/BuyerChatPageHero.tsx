import type { BuyerContext, DealPhase, DealState } from '@/lib/types'
import { CopilotPageHero } from '@/components/shared/CopilotPageHero'

interface HeroCopy {
  leading: string
  accent: string
  trailing: string
}

/**
 * Resolve buyer-chat hero copy from negotiation phase + buyer context.
 * Phase wins over context (e.g. once you're negotiating, the headline shifts
 * away from the research-mode framing).
 */
function resolveBuyerHeroCopy(
  buyerContext: BuyerContext,
  phase: DealPhase | null | undefined
): HeroCopy {
  if (phase === 'negotiation' || phase === 'closing') {
    return { leading: "Let's close this", accent: 'deal', trailing: '.' }
  }
  if (buyerContext === 'reviewing_deal') {
    return { leading: "Let's decode this", accent: 'deal', trailing: '.' }
  }
  if (buyerContext === 'at_dealership') {
    return { leading: "You've got", accent: 'backup', trailing: ' — stay sharp.' }
  }
  return { leading: "Let's find the", accent: 'right car', trailing: '.' }
}

interface BuyerChatPageHeroProps {
  dealState: DealState | null
  buyerContext: BuyerContext
  isDesktop: boolean
}

export function BuyerChatPageHero({ dealState, buyerContext, isDesktop }: BuyerChatPageHeroProps) {
  const activeDeal = dealState?.deals?.find((deal) => deal.id === dealState.activeDealId) ?? null
  const phase = activeDeal?.phase ?? null
  const copy = resolveBuyerHeroCopy(buyerContext, phase)

  return (
    <CopilotPageHero
      leading={copy.leading}
      accent={copy.accent}
      trailing={copy.trailing}
      isDesktop={isDesktop}
    />
  )
}
