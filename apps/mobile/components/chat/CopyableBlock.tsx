import { useState, useCallback, type ReactNode } from 'react'
import { TouchableOpacity } from 'react-native'
import { YStack, XStack } from 'tamagui'
import { Copy, Check } from '@tamagui/lucide-icons'

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

  const handleCopy = useCallback(async () => {
    await copyToClipboard(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [text])

  return (
    <YStack
      borderLeftWidth={3}
      borderLeftColor="$brand"
      paddingLeft={12}
      marginVertical={6}
      paddingVertical={2}
      backgroundColor="$background"
      borderRadius={8}
      position="relative"
    >
      <XStack position="absolute" top={4} right={4} zIndex={1}>
        <TouchableOpacity
          onPress={handleCopy}
          activeOpacity={0.6}
          style={{
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {copied ? (
            <Check size={14} color="$positive" />
          ) : (
            <Copy size={14} color="$placeholderColor" />
          )}
        </TouchableOpacity>
      </XStack>
      <YStack paddingRight={40}>{children}</YStack>
    </YStack>
  )
}
