import { TouchableOpacity, Platform } from 'react-native'
import { XStack, YStack, Text, Button, useTheme } from 'tamagui'
import { Sparkles, X } from '@tamagui/lucide-icons'
import { palette } from '@/lib/theme/tokens'

type RecapTimelinePromptBannerProps = {
  onOpenRecap: () => void
  onDismiss: () => void
}

/**
 * Dismissible nudge above the composer: buyer likely finished a purchase — offer deal recap.
 * Card-style strip (brand accent) so it reads as intentional UI, not a flat system bar.
 */
export function RecapTimelinePromptBanner({
  onOpenRecap,
  onDismiss,
}: RecapTimelinePromptBannerProps) {
  const theme = useTheme()
  const shadowColor = (theme.shadowColor?.val as string) ?? palette.shadowOverlay

  const nativeShadow =
    Platform.OS === 'web'
      ? {}
      : {
          shadowColor,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.12,
          shadowRadius: 10,
          elevation: 4,
        }

  const webShadow =
    Platform.OS === 'web'
      ? ({
          boxShadow: `0 2px 12px ${shadowColor}`,
        } as const)
      : {}

  return (
    <XStack
      marginHorizontal="$3"
      marginBottom="$2"
      borderRadius="$4"
      borderWidth={1}
      borderColor="$borderColor"
      backgroundColor="$brandSubtle"
      overflow="hidden"
      style={{ ...nativeShadow, ...webShadow }}
    >
      <YStack width={4} backgroundColor="$brand" flexShrink={0} />
      <YStack flex={1} minWidth={0} padding="$3.5" gap="$3">
        <XStack alignItems="flex-start" justifyContent="space-between" gap="$2">
          <XStack flex={1} gap="$3" alignItems="flex-start" minWidth={0}>
            <YStack
              width={44}
              height={44}
              borderRadius={22}
              backgroundColor="$backgroundStrong"
              borderWidth={1}
              borderColor="$borderColor"
              alignItems="center"
              justifyContent="center"
              flexShrink={0}
            >
              <Sparkles size={22} color="$brand" />
            </YStack>
            <YStack flex={1} minWidth={0} gap="$1.5">
              <Text
                fontSize={16}
                lineHeight={22}
                fontWeight="700"
                color="$color"
                letterSpacing={-0.2}
              >
                Want a deal recap?
              </Text>
              <Text fontSize={13} lineHeight={19} color="$color" opacity={0.78}>
                See a timeline of your deal and estimated savings. You can create a share-friendly
                version on the next screen.
              </Text>
            </YStack>
          </XStack>
          <TouchableOpacity
            onPress={onDismiss}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            {...(Platform.OS === 'web'
              ? ({ 'aria-label': 'Dismiss recap prompt' } as any)
              : { accessibilityLabel: 'Dismiss recap prompt' })}
          >
            <YStack
              width={36}
              height={36}
              borderRadius={18}
              alignItems="center"
              justifyContent="center"
              backgroundColor="$backgroundHover"
              hoverStyle={
                Platform.OS === 'web' ? { backgroundColor: '$backgroundPress' } : undefined
              }
            >
              <X size={18} color="$placeholderColor" />
            </YStack>
          </TouchableOpacity>
        </XStack>
        <XStack gap="$2.5" flexWrap="wrap" alignItems="center">
          <Button size="$3" theme="active" borderRadius="$3" onPress={onOpenRecap}>
            Open recap
          </Button>
          <Button size="$3" variant="outlined" borderRadius="$3" onPress={onDismiss}>
            Not now
          </Button>
        </XStack>
      </YStack>
    </XStack>
  )
}
