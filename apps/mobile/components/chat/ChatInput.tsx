import { useState } from 'react'
import { TouchableOpacity, Alert, Platform } from 'react-native'
import { XStack, Input } from 'tamagui'
import { Camera, Send } from '@tamagui/lucide-icons'
import { VoiceButton } from './VoiceButton'

interface ChatInputProps {
  onSend: (content: string, imageUri?: string) => void
  disabled?: boolean
  placeholder?: string
}

export function ChatInput({ onSend, disabled, placeholder }: ChatInputProps) {
  const [text, setText] = useState('')

  const handleSend = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSend(trimmed)
    setText('')
  }

  const handlePhoto = () => {
    const alertFn =
      Platform.OS === 'web' ? (t: string, m: string) => window.alert(`${t}: ${m}`) : Alert.alert
    alertFn(
      'Photo Upload',
      'Camera integration coming soon. For now, describe the deal sheet in chat.'
    )
  }

  const handleVoice = () => {
    const alertFn =
      Platform.OS === 'web' ? (t: string, m: string) => window.alert(`${t}: ${m}`) : Alert.alert
    alertFn('Voice Mode', 'Voice input coming soon. Type your message for now.')
  }

  const hasText = text.trim().length > 0

  return (
    <XStack
      paddingHorizontal="$3"
      paddingVertical="$2"
      gap="$2"
      alignItems="flex-end"
      backgroundColor="$backgroundStrong"
      borderTopWidth={1}
      borderTopColor="$borderColor"
    >
      <TouchableOpacity onPress={handlePhoto} activeOpacity={0.6}>
        <XStack
          width={44}
          height={44}
          borderRadius={100}
          backgroundColor="$backgroundHover"
          borderWidth={1}
          borderColor="$borderColor"
          alignItems="center"
          justifyContent="center"
        >
          <Camera size={20} color="$placeholderColor" />
        </XStack>
      </TouchableOpacity>

      <Input
        flex={1}
        size="$4"
        placeholder={placeholder ?? 'Message...'}
        value={text}
        onChangeText={setText}
        onSubmitEditing={handleSend}
        returnKeyType="send"
        backgroundColor="$backgroundHover"
        borderColor="$borderColor"
        borderRadius="$5"
        disabled={disabled}
      />

      {hasText ? (
        <TouchableOpacity onPress={handleSend} disabled={disabled} activeOpacity={0.6}>
          <XStack
            width={44}
            height={44}
            borderRadius={100}
            backgroundColor="$brand"
            alignItems="center"
            justifyContent="center"
            opacity={disabled ? 0.5 : 1}
          >
            <Send size={20} color="white" />
          </XStack>
        </TouchableOpacity>
      ) : (
        <VoiceButton onPress={handleVoice} />
      )}
    </XStack>
  )
}
