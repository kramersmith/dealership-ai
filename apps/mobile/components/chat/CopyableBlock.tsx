import { useState, useCallback, useRef, type ReactNode } from 'react'
import { Platform, TouchableOpacity, Animated, View } from 'react-native'
import { YStack, XStack } from 'tamagui'
import { Copy, Check } from '@tamagui/lucide-icons'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { palette } from '@/lib/theme/tokens'
import { useHoverState } from '@/hooks/useHoverState'
import { CHAT_MARKDOWN_PARAGRAPH_SPACING_PX } from './markdownStyles'

interface CopyableBlockProps {
  children: ReactNode
  text: string
}

async function copyToClipboard(text: string) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    }
  } catch {
    // Clipboard API not available — fail silently
  }
}

export function CopyableBlock({ children, text }: CopyableBlockProps) {
  const [copied, setCopied] = useState(false)
  const scale = useRef(new Animated.Value(1)).current
  const { isHovered, hoverHandlers } = useHoverState()

  const handleCopy = useCallback(async () => {
    await copyToClipboard(text)
    setCopied(true)
    Animated.sequence([
      Animated.timing(scale, {
        toValue: 1.3,
        duration: 150,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: 150,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]).start()
    setTimeout(() => setCopied(false), 1500)
  }, [text, scale])

  return (
    <YStack
      borderLeftWidth={2}
      borderLeftColor={palette.copilotEmerald}
      borderTopWidth={1}
      borderRightWidth={1}
      borderBottomWidth={1}
      borderTopColor={palette.ghostBorder}
      borderRightColor={palette.ghostBorder}
      borderBottomColor={palette.ghostBorder}
      paddingLeft={14}
      marginVertical={8}
      paddingVertical={10}
      backgroundColor={palette.ghostBg}
      borderRadius={8}
      position="relative"
    >
      <XStack position="absolute" top={4} right={4} zIndex={1}>
        <TouchableOpacity
          onPress={handleCopy}
          activeOpacity={0.85}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          {...hoverHandlers}
          style={{
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: isHovered ? palette.ghostBgHover : palette.ghostBg,
              borderWidth: 1,
              borderColor: isHovered ? palette.ghostBorderHover : palette.ghostBorder,
              ...(Platform.OS === 'web'
                ? ({
                    transition: 'background-color 160ms ease, border-color 160ms ease',
                  } as any)
                : null),
            }}
          >
            <Animated.View style={{ transform: [{ scale }] }}>
              {copied ? (
                <Check size={14} color="$positive" />
              ) : (
                <Copy size={14} color="$placeholderColor" />
              )}
            </Animated.View>
          </View>
        </TouchableOpacity>
      </XStack>
      <YStack paddingRight={40} marginBottom={-CHAT_MARKDOWN_PARAGRAPH_SPACING_PX}>
        {children}
      </YStack>
    </YStack>
  )
}
