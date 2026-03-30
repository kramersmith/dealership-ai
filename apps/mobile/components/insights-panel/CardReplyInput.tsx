import { useState, useCallback, useRef, useEffect } from 'react'
import {
  TextInput,
  TouchableOpacity,
  Keyboard,
  Platform,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native'
import { XStack, YStack, Text, useTheme } from 'tamagui'
import { Send } from '@tamagui/lucide-icons'
import type { AiPanelCard, QuotedCard } from '@/lib/types'
import { CONFIRMATION_DISPLAY_MS } from '@/lib/constants'

interface CardReplyInputProps {
  card: AiPanelCard
  onSend: (text: string, quotedCard: QuotedCard) => Promise<void>
  onClose: () => void
}

export function CardReplyInput({ card, onSend, onClose }: CardReplyInputProps) {
  const theme = useTheme()
  const [text, setText] = useState('')
  const [justSent, setJustSent] = useState(false)
  const sentTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (sentTimer.current) clearTimeout(sentTimer.current)
    }
  }, [])

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed) return

    const quotedCard: QuotedCard = { title: card.title, type: card.type, content: card.content }
    onSend(trimmed, quotedCard).catch((err) => {
      console.error(
        '[CardReplyInput] sendMessage failed:',
        err instanceof Error ? err.message : err
      )
      setJustSent(false)
    })

    Keyboard.dismiss()
    setText('')
    setJustSent(true)

    if (sentTimer.current) clearTimeout(sentTimer.current)
    sentTimer.current = setTimeout(() => {
      setJustSent(false)
      onClose()
    }, CONFIRMATION_DISPLAY_MS)
  }, [text, card, onSend, onClose])

  const handleKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (Platform.OS !== 'web') return
      const nativeEvent = e.nativeEvent as any
      if (nativeEvent.key === 'Enter' && !nativeEvent.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  if (justSent) {
    return (
      <YStack
        backgroundColor="$backgroundHover"
        borderBottomLeftRadius={12}
        borderBottomRightRadius={12}
        borderWidth={1}
        borderTopWidth={0}
        borderColor="$borderColor"
        marginTop={-12}
        alignItems="center"
        paddingTop="$3"
        paddingBottom="$2.5"
      >
        <Text fontSize={12} fontWeight="500" color="$brand">
          Sent to your advisor
        </Text>
      </YStack>
    )
  }

  return (
    <XStack
      backgroundColor="$backgroundHover"
      borderBottomLeftRadius={12}
      borderBottomRightRadius={12}
      borderWidth={1}
      borderTopWidth={0}
      borderColor="$borderColor"
      marginTop={-12}
      paddingTop="$3"
      paddingBottom="$1.5"
      paddingHorizontal="$2.5"
      alignItems="center"
      gap="$1.5"
    >
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Reply to this card..."
        placeholderTextColor={theme.placeholderColor?.val as string}
        multiline
        autoFocus
        onKeyPress={handleKeyPress}
        onSubmitEditing={handleSend}
        blurOnSubmit={false}
        style={
          {
            flex: 1,
            fontSize: 13,
            color: theme.color?.val as string,
            minHeight: 36,
            maxHeight: 72,
            textAlignVertical: 'top',
            paddingTop: 8,
            paddingBottom: 8,
            paddingLeft: 0,
            paddingRight: 0,
            margin: 0,
            outlineStyle: 'none',
            borderWidth: 0,
          } as any
        }
      />
      <TouchableOpacity
        onPress={text.trim() ? handleSend : onClose}
        activeOpacity={0.6}
        style={{
          width: 44,
          height: 44,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        {text.trim() ? (
          <Send size={16} color="$placeholderColor" />
        ) : (
          <Text fontSize={12} fontWeight="500" color="$placeholderColor">
            ✕
          </Text>
        )}
      </TouchableOpacity>
    </XStack>
  )
}
