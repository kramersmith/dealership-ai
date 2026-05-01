import type { ReactNode } from 'react'
import { XStack, YStack, Text } from 'tamagui'
import { DISPLAY_FONT_FAMILY } from '@/lib/constants'
import { palette } from '@/lib/theme/tokens'

interface BuyerChatHeaderProps {
  sessionTitle: string | null | undefined
  /** Optional one-liner under the coach line (e.g. collapsed insights preview). */
  previewLine?: string | null
  isDesktop: boolean
  /** Inside frosted chat rail — no outer spacing / no preview block (parent renders preview). */
  embedded?: boolean
  /**
   * Optional leading content rendered before the title (e.g. a small
   * insights / panel-toggle icon).
   */
  leftSlot?: ReactNode
  /**
   * Optional right-side content. Replaces the previous built-in phase
   * progress dots. Pass an inline insights preview (chips, paused state,
   * analyzing state) so the header doubles as the deal-context strip.
   */
  rightSlot?: ReactNode
  /**
   * When true, the session title is suppressed and `rightSlot` takes the
   * full row width. Used when insights are live and the preview chips are
   * the more useful context — the title becomes redundant chrome.
   */
  hideTitle?: boolean
}

export function BuyerChatHeader({
  sessionTitle,
  previewLine,
  isDesktop,
  embedded = false,
  leftSlot,
  rightSlot,
  hideTitle = false,
}: BuyerChatHeaderProps) {
  const trimmedSessionTitle = sessionTitle?.trim() || null
  const headline = trimmedSessionTitle ?? 'New chat'

  const coachCard = (
    <YStack>
      <XStack
        paddingHorizontal={20}
        paddingVertical={16}
        borderRadius={embedded ? 0 : 24}
        borderWidth={embedded ? 0 : 1}
        borderColor="$borderColor"
        backgroundColor="transparent"
        alignItems="center"
        justifyContent="space-between"
        gap="$3"
        flexWrap="wrap"
      >
        {leftSlot ? (
          <XStack alignItems="center" flexShrink={0}>
            {leftSlot}
          </XStack>
        ) : null}
        {hideTitle ? null : (
          <YStack minWidth={0} flexShrink={1} flex={1}>
            <Text
              fontSize={16}
              fontWeight="600"
              color={palette.slate50}
              numberOfLines={1}
              lineHeight={22}
              letterSpacing={-0.2}
              fontFamily={DISPLAY_FONT_FAMILY}
            >
              {headline}
            </Text>
          </YStack>
        )}
        {rightSlot ? (
          <XStack
            alignItems="center"
            gap={8}
            flexShrink={hideTitle ? 1 : 0}
            flex={hideTitle ? 1 : undefined}
            minWidth={0}
            flexWrap="wrap"
          >
            {rightSlot}
          </XStack>
        ) : null}
      </XStack>
      {/* Source: chat header has `border-b border-white/10`. Explicit 1px divider so
          it always renders crisply against the frosted bg. */}
      {embedded ? <YStack height={1} width="100%" backgroundColor={palette.ghostBorder} /> : null}
    </YStack>
  )

  if (embedded) {
    return coachCard
  }

  return (
    <YStack gap="$2" paddingBottom="$3">
      {coachCard}
      {previewLine?.trim() ? (
        <Text fontSize={13} lineHeight={19} color="$color" numberOfLines={isDesktop ? 2 : 3}>
          {previewLine.trim()}
        </Text>
      ) : null}
    </YStack>
  )
}
