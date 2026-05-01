import type { ReactNode } from 'react'
import { Animated, Platform, View, type LayoutChangeEvent } from 'react-native'
import { YStack } from 'tamagui'
import { useSlideIn } from '@/hooks/useAnimatedValue'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'

/** Floating tray (rounded dock): mount slide-up + fade — not the inner input row. */
const COMPOSER_TRAY_ENTRANCE_MS = 360
const COMPOSER_TRAY_ENTRANCE_OFFSET_Y = 72

interface ChatComposerOverlayProps {
  isDesktop: boolean
  composerTrayStyle: any
  notices?: ReactNode
  queuePreview?: ReactNode
  composer: ReactNode
  onComposerHeightChange?: (height: number) => void
}

/**
 * Composer band — renders notices, queue preview, and the composer itself as
 * normal flex content (NOT absolutely positioned). Designed to sit at the bottom
 * of the FrostedChatRail as a sibling of the scrollable message list, matching
 * the source's flex column layout.
 */
export function ChatComposerOverlay({
  composerTrayStyle,
  notices,
  queuePreview,
  composer,
  onComposerHeightChange,
}: ChatComposerOverlayProps) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const traySlideMs = prefersReducedMotion ? 0 : COMPOSER_TRAY_ENTRANCE_MS
  const { opacity: trayOpacity, translateY: trayTranslateY } = useSlideIn(
    traySlideMs,
    0,
    COMPOSER_TRAY_ENTRANCE_OFFSET_Y
  )

  const handleLayout = (layoutEvent: LayoutChangeEvent) => {
    if (!onComposerHeightChange) return
    onComposerHeightChange(Math.ceil(layoutEvent.nativeEvent.layout.height))
  }

  return (
    <YStack
      flexShrink={0}
      {...(Platform.OS === 'web' ? ({ id: 'chat-composer-area' } as any) : {})}
    >
      {notices}
      <View style={{ position: 'relative' }}>
        {queuePreview}
        <Animated.View
          onLayout={handleLayout}
          style={[
            composerTrayStyle,
            { opacity: trayOpacity, transform: [{ translateY: trayTranslateY }] },
          ]}
        >
          {composer}
        </Animated.View>
      </View>
    </YStack>
  )
}
