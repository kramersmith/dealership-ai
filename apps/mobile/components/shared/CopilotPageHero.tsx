import { type ReactNode } from 'react'
import { XStack, YStack, Text } from 'tamagui'
import { DISPLAY_FONT_FAMILY, MONO_FONT_FAMILY } from '@/lib/constants'
import { palette } from '@/lib/theme/tokens'

interface CopilotPageHeroProps {
  /** Plain leading text rendered before the italic emerald accent. */
  leading: string
  /** Italic emerald accent word(s). */
  accent: string
  /** Plain trailing text rendered after the accent (defaults to "."). */
  trailing?: string
  /** Optional secondary line under the headline (description). */
  description?: string | null
  /** Optional right-aligned mono caption (e.g. "SESSION · 12m"). */
  caption?: string | null
  isDesktop: boolean
  /** Slot for arbitrary right-side content, e.g. status badge. */
  rightAccessory?: ReactNode
}

/**
 * Shared page hero — large `font-light` headline with an italic emerald accent,
 * matching the chat reference. Source: BuyerChatPageHero.
 */
export function CopilotPageHero({
  leading,
  accent,
  trailing = '.',
  description,
  caption,
  isDesktop,
  rightAccessory,
}: CopilotPageHeroProps) {
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

  return (
    <XStack
      justifyContent="space-between"
      alignItems="flex-end"
      flexWrap="wrap"
      gap="$3"
      paddingBottom="$3"
    >
      <YStack gap="$2" flexShrink={1} minWidth={0} flex={1}>
        <Text {...baseTextProps}>
          {leading} <Text {...accentProps}>{accent}</Text>
          {trailing}
        </Text>
        {description ? (
          <Text fontSize={14} color={palette.slate400} lineHeight={20}>
            {description}
          </Text>
        ) : null}
      </YStack>
      {rightAccessory ?? null}
      {caption != null ? (
        <Text
          fontSize={11}
          fontWeight="500"
          color={palette.whiteTint55}
          letterSpacing={0.4}
          fontFamily={MONO_FONT_FAMILY}
        >
          {caption}
        </Text>
      ) : null}
    </XStack>
  )
}
