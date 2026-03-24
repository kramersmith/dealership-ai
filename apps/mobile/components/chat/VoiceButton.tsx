import { TouchableOpacity } from 'react-native'
import { XStack } from 'tamagui'
import { Mic } from '@tamagui/lucide-icons'

interface VoiceButtonProps {
  onPress: () => void
}

export function VoiceButton({ onPress }: VoiceButtonProps) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.6}>
      <XStack
        width={44}
        height={44}
        borderRadius={100}
        backgroundColor="$backgroundStrong"
        borderWidth={1}
        borderColor="$borderColor"
        alignItems="center"
        justifyContent="center"
      >
        <Mic size={20} color="$placeholderColor" />
      </XStack>
    </TouchableOpacity>
  )
}
