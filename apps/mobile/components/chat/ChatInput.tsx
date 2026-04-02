import { useState, useCallback, useRef, useEffect } from 'react'
import {
  TouchableOpacity,
  Alert,
  Platform,
  TextInput,
  Animated,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
  type TextInputKeyPressEventData,
} from 'react-native'
import { XStack, useTheme } from 'tamagui'
import { Camera, Send } from '@tamagui/lucide-icons'
import { palette } from '@/lib/theme/tokens'
import { useVisibilityTransition } from '@/hooks/useAnimatedValue'
import { VoiceButton } from './VoiceButton'

const MIN_INPUT_HEIGHT = 44
const MAX_INPUT_HEIGHT = 118

interface ChatInputProps {
  onSend: (content: string, imageUri?: string) => void
  disabled?: boolean
  placeholder?: string
  visible?: boolean
}

export function ChatInput({ onSend, disabled, placeholder, visible = true }: ChatInputProps) {
  const [text, setText] = useState('')
  const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT)
  const [focused, setFocused] = useState(false)
  const theme = useTheme()
  const focusAnim = useRef(new Animated.Value(0)).current
  const { opacity: visibilityOpacity, translateY: visibilityTranslateY } = useVisibilityTransition({
    visible,
    duration: 240,
    hiddenOffsetY: 20,
    animateOnMount: true,
  })

  useEffect(() => {
    Animated.timing(focusAnim, {
      toValue: focused ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start()
  }, [focused, focusAnim])

  const animatedBorderColor = focusAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.borderColor?.val as string, theme.borderColorHover?.val as string],
  })

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSend(trimmed)
    setText('')
    setInputHeight(MIN_INPUT_HEIGHT)
  }, [text, onSend])

  const handleChangeText = useCallback((t: string) => {
    setText(t)
    if (t.length === 0) {
      setInputHeight(MIN_INPUT_HEIGHT)
    }
  }, [])

  const handleContentSizeChange = useCallback(
    (e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      const h = e.nativeEvent.contentSize.height
      if (!h || h < 1) return
      const next = Math.min(MAX_INPUT_HEIGHT, Math.max(MIN_INPUT_HEIGHT, Math.ceil(h)))
      setInputHeight((prev) => (prev === next ? prev : next))
    },
    []
  )

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
    <Animated.View
      style={{ opacity: visibilityOpacity, transform: [{ translateY: visibilityTranslateY }] }}
    >
      <XStack
        paddingHorizontal="$3"
        paddingTop="$2"
        paddingBottom="$2"
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

        <Animated.View
          style={{
            flex: 1,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: animatedBorderColor,
            backgroundColor: theme.backgroundHover?.val as string,
            overflow: 'hidden',
            maxHeight: 120,
          }}
        >
          <TextInput
            style={
              {
                fontSize: 15,
                lineHeight: 20,
                color: theme.color?.val as string,
                paddingHorizontal: 16,
                paddingTop: 12,
                paddingBottom: 12,
                height: inputHeight,
                margin: 0,
                maxHeight: MAX_INPUT_HEIGHT,
                outlineWidth: 0,
                scrollbarWidth: 'thin',
                scrollbarColor: `${theme.placeholderColor?.val ?? palette.overlay} transparent`,
              } as any
            }
            placeholder={placeholder ?? 'Message...'}
            placeholderTextColor={theme.placeholderColor?.val as string}
            value={text}
            onChangeText={handleChangeText}
            onContentSizeChange={handleContentSizeChange}
            onKeyPress={handleKeyPress}
            multiline
            scrollEnabled={inputHeight >= MAX_INPUT_HEIGHT}
            editable={!disabled}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
        </Animated.View>

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
    </Animated.View>
  )
}
