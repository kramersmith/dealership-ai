import { Animated, Platform, Pressable, View } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import { XStack, Text } from 'tamagui'
import { ChevronLeft, MessageSquarePlus, ScrollText, Sparkles } from '@tamagui/lucide-icons'
import { palette } from '@/lib/theme/tokens'
import { DISPLAY_FONT_FAMILY } from '@/lib/constants'
import { HeaderIconButton } from '@/components/shared/HeaderIconButton'
import { useIconEntrance } from '@/hooks/useAnimatedValue'
import { useHoverState } from '@/hooks/useHoverState'

interface BuyerChatTopNavProps {
  onBack: () => void
  onNewChat: () => void
  recapHrefAvailable: boolean
  onRecapPress?: () => void
  isDesktop: boolean
  /** When provided, renders an insights-panel toggle button left of the new-chat icon. */
  onInsightsTogglePress?: () => void
  /** True when the insights panel is currently visible — hides the toggle button. */
  isInsightsOpen?: boolean
  /** True while the insights panel is regenerating — shows a small emerald dot on the icon. */
  isInsightsAnalyzing?: boolean
}

export function BuyerChatTopNav({
  onBack,
  onNewChat,
  recapHrefAvailable,
  onRecapPress,
  isDesktop,
  onInsightsTogglePress,
  isInsightsOpen,
  isInsightsAnalyzing,
}: BuyerChatTopNavProps) {
  const isFocused = useIsFocused()
  const backIconAnim = useIconEntrance(isFocused)
  return (
    <XStack width="100%" height={64} alignItems="center" justifyContent="space-between" gap="$3">
      <XStack alignItems="center" gap="$2" flexShrink={0}>
        <HeaderIconButton onPress={onBack} accessibilityLabel="Back to chats">
          <Animated.View
            style={{
              opacity: backIconAnim.opacity,
              transform: [{ rotate: backIconAnim.rotate }],
            }}
          >
            <ChevronLeft size={20} color={palette.slate400} />
          </Animated.View>
        </HeaderIconButton>
        <Text
          fontSize={16}
          fontWeight="500"
          color={palette.slate100}
          letterSpacing={-0.3}
          fontFamily={DISPLAY_FONT_FAMILY}
        >
          Dealership
          <Text color={palette.copilotEmerald} fontFamily={DISPLAY_FONT_FAMILY}>
            AI
          </Text>
          <Text color={palette.copilotEmerald} fontFamily={DISPLAY_FONT_FAMILY}>
            .
          </Text>
        </Text>
      </XStack>

      {/* Flex spacer so the right-side actions hug the right edge. */}
      <XStack flex={1} />

      <XStack alignItems="center" gap="$2" flexShrink={0}>
        {recapHrefAvailable && onRecapPress ? (
          <HeaderIconButton onPress={onRecapPress} accessibilityLabel="Open deal recap">
            <ScrollText size={20} color={palette.slate400} />
          </HeaderIconButton>
        ) : null}
        {onInsightsTogglePress && !isInsightsOpen ? (
          <InsightsToggleButton
            onPress={onInsightsTogglePress}
            isAnalyzing={!!isInsightsAnalyzing}
            isDesktop={isDesktop}
          />
        ) : null}
        <HeaderIconButton onPress={onNewChat} accessibilityLabel="Start new chat">
          <MessageSquarePlus size={20} color={palette.slate400} />
        </HeaderIconButton>
      </XStack>
    </XStack>
  )
}

/**
 * Emerald-accented "Insights" pill — lives in the top nav so opening/closing
 * the panel never reflows chat content. Labeled (not just an icon) so the
 * affordance is discoverable; emerald accent ties it to the panel's content.
 */
function InsightsToggleButton({
  onPress,
  isAnalyzing,
}: {
  onPress: () => void
  isAnalyzing: boolean
  /** No longer used — kept in the prop type for caller compatibility. */
  isDesktop?: boolean
}) {
  const { isHovered, hoverHandlers } = useHoverState()

  // Emerald-tinted surface so the toggle stands apart from the neutral-ghost
  // icon buttons (back / new-chat) that share the row.
  const idleBg = palette.copilotEmeraldTint10
  const idleBorder = palette.copilotEmeraldBorder30
  const hoverBg = palette.copilotEmeraldTint18
  const hoverBorder = palette.copilotEmeraldBorder55

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        isAnalyzing ? 'Open insights panel — updating now' : 'Open insights panel'
      }
      {...hoverHandlers}
      // 44-tall touch target; visible pill is 32-tall via the inner View.
      style={({ pressed }) => ({
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.88 : 1,
        ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null),
      })}
    >
      <View
        style={{
          height: 32,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          paddingHorizontal: 12,
          borderRadius: 999,
          backgroundColor: isHovered ? hoverBg : idleBg,
          borderWidth: 1,
          borderColor: isHovered ? hoverBorder : idleBorder,
          ...(Platform.OS === 'web'
            ? ({
                transition: 'background-color 160ms ease, border-color 160ms ease',
              } as any)
            : null),
        }}
      >
        <Sparkles size={14} color={palette.copilotEmerald} />
        <Text fontSize={13} fontWeight="600" color="#a7f3d0">
          Insights
        </Text>
        {isAnalyzing ? (
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              backgroundColor: palette.copilotEmerald,
              marginLeft: 2,
            }}
          />
        ) : null}
      </View>
    </Pressable>
  )
}
