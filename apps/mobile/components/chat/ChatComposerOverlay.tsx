import type { ReactNode } from 'react'
import { Animated, View, type LayoutChangeEvent } from 'react-native'
import { YStack } from 'tamagui'
import { useSlideIn } from '@/hooks/useAnimatedValue'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'

/** Floating tray (rounded dock): mount slide-up + fade — not the inner input row. */
const COMPOSER_TRAY_ENTRANCE_MS = 360
const COMPOSER_TRAY_ENTRANCE_OFFSET_Y = 72

interface ChatComposerOverlayProps {
  isDesktop: boolean
  desktopLeftPx?: number
  desktopRightPx?: number
  composerTrayStyle: any
  notices?: ReactNode
  queuePreview?: ReactNode
  composer: ReactNode
  onDesktopComposerTrayHeightChange?: (height: number) => void
}

export function ChatComposerOverlay({
  isDesktop,
  desktopLeftPx = 0,
  desktopRightPx = 0,
  composerTrayStyle,
  notices,
  queuePreview,
  composer,
  onDesktopComposerTrayHeightChange,
}: ChatComposerOverlayProps) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const traySlideMs = prefersReducedMotion ? 0 : COMPOSER_TRAY_ENTRANCE_MS
  const { opacity: trayOpacity, translateY: trayTranslateY } = useSlideIn(
    traySlideMs,
    0,
    COMPOSER_TRAY_ENTRANCE_OFFSET_Y
  )

  const handleDesktopComposerTrayLayout = (layoutEvent: LayoutChangeEvent) => {
    if (!onDesktopComposerTrayHeightChange) return
    const nextHeight = Math.ceil(layoutEvent.nativeEvent.layout.height)
    onDesktopComposerTrayHeightChange(nextHeight)
  }

  if (isDesktop) {
    return (
      <View
        style={{
          position: 'absolute',
          left: desktopLeftPx,
          right: desktopRightPx,
          bottom: 0,
          zIndex: 4,
          pointerEvents: 'box-none',
        }}
      >
        <YStack style={{ pointerEvents: 'box-none' } as any}>
          {notices}
          <View style={{ position: 'relative' }}>
            {queuePreview}
            <Animated.View
              onLayout={handleDesktopComposerTrayLayout}
              style={[
                composerTrayStyle,
                { opacity: trayOpacity, transform: [{ translateY: trayTranslateY }] },
              ]}
            >
              {composer}
            </Animated.View>
          </View>
        </YStack>
      </View>
    )
  }

  return (
    <>
      {notices}
      <View style={{ position: 'relative' }}>
        {queuePreview}
        <Animated.View
          style={[
            composerTrayStyle,
            { opacity: trayOpacity, transform: [{ translateY: trayTranslateY }] },
          ]}
        >
          {composer}
        </Animated.View>
      </View>
    </>
  )
}
