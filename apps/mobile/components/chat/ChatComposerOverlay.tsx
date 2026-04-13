import type { ReactNode } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'
import { YStack } from 'tamagui'

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
            <YStack onLayout={handleDesktopComposerTrayLayout} style={composerTrayStyle}>
              {composer}
            </YStack>
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
        <YStack style={composerTrayStyle}>{composer}</YStack>
      </View>
    </>
  )
}
