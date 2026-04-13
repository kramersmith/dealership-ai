import type { ReactNode } from 'react'
import { Animated, Platform, Pressable } from 'react-native'
import { Sparkles } from '@tamagui/lucide-icons'
import { Text, XStack, YStack, useTheme } from 'tamagui'
import { HeaderIconButton } from '@/components/shared'
import { useIconEntrance } from '@/hooks/useAnimatedValue'
import type { DesktopPanelShellState } from '@/hooks/useDesktopInsightsShell'
import type { InsightsUpdateMode } from '@/lib/types'
import { palette } from '@/lib/theme/tokens'

/** Shared pill frame for single-icon dock buttons (collapse / expand idle). */
function DockIconPill({ children, shadowColor }: { children: ReactNode; shadowColor: string }) {
  return (
    <XStack
      alignItems="center"
      justifyContent="center"
      width={44}
      height={44}
      paddingHorizontal="$0"
      paddingVertical="$2"
      gap="$0"
      backgroundColor="$backgroundStrong"
      borderRadius="$5"
      borderWidth={1}
      borderColor="$borderColor"
      {...(Platform.OS === 'web'
        ? {
            style: {
              boxShadow: `0 8px 18px ${shadowColor}`,
            },
          }
        : null)}
    >
      {children}
    </XStack>
  )
}

function DockAnimatedIcon({ color = '$color' }: { color?: string }) {
  const entrance = useIconEntrance(true)

  return (
    <Animated.View
      style={{
        opacity: entrance.opacity,
        transform: [{ rotate: entrance.rotate }],
      }}
    >
      <Sparkles size={16} color={color} />
    </Animated.View>
  )
}

interface DesktopInsightsDockControlProps {
  shellState: DesktopPanelShellState
  collapsedPreviewText: string
  insightsUpdateMode: InsightsUpdateMode
  launcherOpacity: Animated.Value
  launcherTranslateX: Animated.Value
  topOffsetPx?: number
  rightOffsetPx?: number
  onExpandPress: () => void
}

export function DesktopInsightsDockControl({
  shellState,
  collapsedPreviewText,
  insightsUpdateMode,
  launcherOpacity,
  launcherTranslateX,
  topOffsetPx = 8,
  rightOffsetPx = 12,
  onExpandPress,
}: DesktopInsightsDockControlProps) {
  const theme = useTheme()
  const shadowColor = theme.shadowColor?.val ?? palette.shadowOverlay

  if (shellState === 'hidden') {
    return null
  }

  if (shellState === 'expanded') return null

  const content =
    shellState === 'collapsed_idle' ? (
      <HeaderIconButton onPress={onExpandPress} accessibilityLabel="Open insights panel">
        <DockIconPill shadowColor={shadowColor}>
          <DockAnimatedIcon />
        </DockIconPill>
      </HeaderIconButton>
    ) : (
      <Pressable
        onPress={onExpandPress}
        accessibilityRole="button"
        accessibilityLabel="Open insights panel"
        style={({ pressed }) => ({
          alignSelf: 'flex-end',
          minHeight: 44,
          opacity: pressed ? 0.96 : 1,
          transform: [{ scale: pressed ? 0.995 : 1 }],
          backgroundColor: 'transparent',
          borderWidth: 0,
          borderColor: 'transparent',
          ...(Platform.OS === 'web'
            ? {
                outlineWidth: 0,
                boxShadow: 'none',
                appearance: 'none',
                cursor: 'pointer',
              }
            : null),
        })}
      >
        <XStack
          alignItems="center"
          gap="$2.5"
          height={44}
          justifyContent="center"
          paddingHorizontal="$3"
          paddingVertical="$2"
          backgroundColor="$backgroundStrong"
          borderRadius="$5"
          borderWidth={1}
          borderColor="$borderColor"
          {...(Platform.OS === 'web'
            ? {
                style: {
                  boxShadow: `0 8px 18px ${shadowColor}`,
                },
              }
            : null)}
        >
          <DockAnimatedIcon />
          <Text
            fontSize={12}
            fontWeight="600"
            color="$color"
            numberOfLines={1}
            maxWidth={420}
            flexShrink={1}
          >
            {collapsedPreviewText || 'Updating insights...'}
          </Text>
          <Text fontSize={11} color="$placeholderColor">
            {insightsUpdateMode === 'paused' ? 'Paused' : 'Live'}
          </Text>
        </XStack>
      </Pressable>
    )

  return (
    <YStack
      position="absolute"
      top={topOffsetPx}
      right={rightOffsetPx}
      zIndex={4}
      style={{ pointerEvents: 'box-none' } as any}
    >
      <Animated.View
        style={{
          opacity: launcherOpacity,
          transform: [{ translateX: launcherTranslateX }],
        }}
      >
        {content}
      </Animated.View>
    </YStack>
  )
}
