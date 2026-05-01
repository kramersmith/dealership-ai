import { Platform, TouchableOpacity } from 'react-native'
import { XStack, useThemeName } from 'tamagui'
import { Mic } from '@tamagui/lucide-icons'
import { palette } from '@/lib/theme/tokens'

interface VoiceButtonProps {
  onPress: () => void
}

export function VoiceButton({ onPress }: VoiceButtonProps) {
  const themeName = useThemeName()
  const isCopilotChat = themeName === 'dark_copilot'

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      {...(Platform.OS === 'web'
        ? ({ 'aria-label': 'Voice input (coming soon)' } as any)
        : { accessibilityLabel: 'Voice input (coming soon)' })}
    >
      <XStack
        width={44}
        height={44}
        borderRadius={100}
        backgroundColor={isCopilotChat ? palette.ghostBg : '$backgroundStrong'}
        borderWidth={1}
        borderColor={isCopilotChat ? palette.copilotComposerFieldBorder : '$borderColor'}
        alignItems="center"
        justifyContent="center"
      >
        <Mic size={18} color="$placeholderColor" />
      </XStack>
    </TouchableOpacity>
  )
}
