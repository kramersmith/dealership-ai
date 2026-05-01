import { XStack, YStack, Text } from 'tamagui'
import { DISPLAY_FONT_FAMILY } from '@/lib/constants'
import type { BuyerContext, DealPhase, DealState } from '@/lib/types'
import { palette } from '@/lib/theme/tokens'

function HeroHeadline({
  buyerContext,
  phase,
  isDesktop,
}: {
  buyerContext: BuyerContext
  phase: DealPhase | null | undefined
  isDesktop: boolean
}) {
  const titleSize = isDesktop ? 48 : 32
  const lineHeight = Math.round(titleSize * 1.05)

  const baseTextProps = {
    fontSize: titleSize,
    fontWeight: '300' as const,
    color: '$color' as const,
    lineHeight,
    letterSpacing: isDesktop ? -1.4 : -0.8,
    flexShrink: 1,
    fontFamily: DISPLAY_FONT_FAMILY,
  }
  const accentProps = {
    fontStyle: 'italic' as const,
    fontWeight: '400' as const,
    color: palette.copilotEmerald,
    fontFamily: DISPLAY_FONT_FAMILY,
  }

  if (phase === 'negotiation' || phase === 'closing') {
    return (
      <Text {...baseTextProps}>
        Let&apos;s close this <Text {...accentProps}>deal</Text>.
      </Text>
    )
  }

  if (buyerContext === 'reviewing_deal') {
    return (
      <Text {...baseTextProps}>
        Let&apos;s decode this <Text {...accentProps}>deal</Text>.
      </Text>
    )
  }
  if (buyerContext === 'at_dealership') {
    return (
      <Text {...baseTextProps}>
        You&apos;ve got <Text {...accentProps}>backup</Text>
        {' — stay sharp.'}
      </Text>
    )
  }
  return (
    <Text {...baseTextProps}>
      Let&apos;s find the <Text {...accentProps}>right car</Text>.
    </Text>
  )
}

interface BuyerChatPageHeroProps {
  dealState: DealState | null
  buyerContext: BuyerContext
  isDesktop: boolean
}

export function BuyerChatPageHero({ dealState, buyerContext, isDesktop }: BuyerChatPageHeroProps) {
  const activeDeal = dealState?.deals?.find((d) => d.id === dealState.activeDealId) ?? null
  const phase = activeDeal?.phase ?? null

  return (
    <XStack paddingBottom="$3">
      <YStack gap="$2" flexShrink={1} minWidth={0} flex={1}>
        <HeroHeadline buyerContext={buyerContext} phase={phase} isDesktop={isDesktop} />
      </YStack>
    </XStack>
  )
}
