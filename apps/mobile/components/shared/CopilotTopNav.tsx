import { type ReactNode } from 'react'
import { Platform, Pressable, View, type ViewStyle } from 'react-native'
import { Animated } from 'react-native'
import { XStack, Text } from 'tamagui'
import { palette } from '@/lib/theme/tokens'
import { DISPLAY_FONT_FAMILY } from '@/lib/constants'
import { HeaderIconButton } from './HeaderIconButton'
import { useIconEntrance } from '@/hooks/useAnimatedValue'

export interface CopilotNavTab {
  /** Stable key for keyed rendering. */
  key: string
  /** Label rendered inside the pill. */
  label: string
  /** True for the currently-active tab (rendered with the light background). */
  active?: boolean
  /** Tap handler — omit for the active tab. */
  onPress?: () => void
  /** Optional leading icon (small, rendered before the label). */
  icon?: ReactNode
  /** Renders as disabled / dimmed when no handler exists. */
  disabled?: boolean
}

interface CopilotTopNavProps {
  /** Wordmark suffix tinted emerald (e.g. "AI" → "DealershipAI"). */
  brandSuffix?: string
  /** Wordmark prefix in default text color. */
  brandPrefix?: string
  /** Pill-style nav tabs rendered between the wordmark and the right slot. */
  tabs?: CopilotNavTab[]
  leftIcon?: ReactNode
  onLeftPress?: () => void
  leftLabel?: string
  rightIcon?: ReactNode
  onRightPress?: () => void
  rightLabel?: string
  /** Arbitrary right-slot content (rendered when `rightIcon` is omitted). */
  rightSlot?: ReactNode
  isDesktop?: boolean
  iconTrigger?: boolean
  /** Inner horizontal padding — every screen passes this so the nav row
   *  aligns with the page content gutter. */
  paddingHorizontal: number
}

/**
 * Shared top navigation for non-chat screens — matches the chat reference layout
 * (sticky bar with `border-b border-white/8`, slate-950 bg, max-width centered)
 * but supports any tab set. Visual source: BuyerChatTopNav.
 */
export function CopilotTopNav({
  brandPrefix = 'Dealership',
  brandSuffix = 'AI',
  tabs,
  leftIcon,
  onLeftPress,
  leftLabel,
  rightIcon,
  onRightPress,
  rightLabel,
  rightSlot,
  isDesktop = false,
  iconTrigger = true,
  paddingHorizontal,
}: CopilotTopNavProps) {
  const leftIconAnim = useIconEntrance(iconTrigger)

  return (
    <View
      style={{
        width: '100%',
        borderBottomWidth: 1,
        borderBottomColor: palette.ghostBgHover,
        backgroundColor: palette.copilotBackground,
      }}
    >
      <XStack
        width="100%"
        height={64}
        paddingHorizontal={paddingHorizontal}
        alignItems="center"
        justifyContent="space-between"
        gap="$3"
      >
        <XStack alignItems="center" gap="$2" flexShrink={0}>
          {leftIcon && onLeftPress ? (
            <HeaderIconButton onPress={onLeftPress} accessibilityLabel={leftLabel ?? 'Navigate'}>
              <Animated.View
                style={{
                  opacity: leftIconAnim.opacity,
                  transform: [{ rotate: leftIconAnim.rotate }],
                }}
              >
                {leftIcon}
              </Animated.View>
            </HeaderIconButton>
          ) : null}
          <Text
            fontSize={16}
            fontWeight="500"
            color={palette.slate100}
            letterSpacing={-0.3}
            fontFamily={DISPLAY_FONT_FAMILY}
          >
            {brandPrefix}
            <Text color={palette.copilotEmerald} fontFamily={DISPLAY_FONT_FAMILY}>
              {brandSuffix}
            </Text>
            <Text color={palette.copilotEmerald} fontFamily={DISPLAY_FONT_FAMILY}>
              .
            </Text>
          </Text>
        </XStack>

        {tabs && tabs.length > 0 ? (
          <XStack
            flex={isDesktop ? 1 : 0}
            justifyContent="center"
            alignItems="center"
            minWidth={0}
            paddingHorizontal="$2"
          >
            <PillNav tabs={tabs} isDesktop={isDesktop} />
          </XStack>
        ) : (
          <XStack flex={1} />
        )}

        <XStack alignItems="center" gap="$2" flexShrink={0}>
          {rightIcon && onRightPress ? (
            <HeaderIconButton onPress={onRightPress} accessibilityLabel={rightLabel ?? 'Action'}>
              {rightIcon}
            </HeaderIconButton>
          ) : rightSlot != null ? (
            rightSlot
          ) : (
            <View style={{ width: 44 }} />
          )}
        </XStack>
      </XStack>
    </View>
  )
}

function PillNav({ tabs }: { tabs: CopilotNavTab[]; isDesktop: boolean }) {
  // Universal sizing: 32-tall pills regardless of viewport.
  const pillHeight = 32
  const pillPaddingH = 14
  const fontSize = 13

  return (
    <XStack
      backgroundColor={palette.copilotFrostedRail}
      borderWidth={1}
      borderColor={palette.ghostBorder}
      borderRadius={999}
      padding={4}
      gap={4}
    >
      {tabs.map((tab) => {
        const interactive = !tab.active && !tab.disabled && !!tab.onPress
        const baseStyle: ViewStyle = {
          paddingHorizontal: pillPaddingH,
          height: pillHeight,
          borderRadius: 999,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }

        if (tab.active) {
          return (
            <View key={tab.key} style={[baseStyle, { backgroundColor: palette.slate50 }]}>
              {tab.icon}
              <Text fontSize={fontSize} fontWeight="500" color={palette.slate900}>
                {tab.label}
              </Text>
            </View>
          )
        }

        return (
          <Pressable
            key={tab.key}
            onPress={interactive ? tab.onPress : undefined}
            disabled={!interactive}
            accessibilityRole="button"
            accessibilityLabel={tab.label}
            accessibilityState={{ disabled: !interactive }}
            // Inner pill is 32-tall for visual density; hitSlop=6 brings the
            // tap target up to 44 vertically so it meets the touch-target rule.
            hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }}
            style={({ pressed }) => ({
              ...baseStyle,
              opacity: tab.disabled ? 0.45 : pressed ? 0.85 : 1,
              ...(Platform.OS === 'web'
                ? ({ cursor: interactive ? 'pointer' : 'default' } as any)
                : null),
            })}
          >
            {tab.icon}
            <Text fontSize={fontSize} fontWeight="500" color={palette.slate400}>
              {tab.label}
            </Text>
          </Pressable>
        )
      })}
    </XStack>
  )
}
