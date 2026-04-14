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
import { XStack, YStack, Text, useTheme } from 'tamagui'
import { Camera, Send, Square, X } from '@tamagui/lucide-icons'
import { PANEL_FOOTER_MIN_HEIGHT } from '@/lib/constants'
import { palette } from '@/lib/theme/tokens'
import { useAnimatedNumber, useVisibilityTransition } from '@/hooks/useAnimatedValue'
import { VoiceButton } from './VoiceButton'

const MIN_INPUT_HEIGHT = 44
const MAX_INPUT_HEIGHT = 118
const INPUT_HEIGHT_TRANSITION_MS = 140
const EDIT_MODE_BANNER_TRANSITION_MS = 220
const EDIT_MODE_BANNER_MAX_HEIGHT = 88
interface ChatInputProps {
  onSend: (content: string, imageUri?: string) => void
  onStop?: () => void
  disabled?: boolean
  isGenerating?: boolean
  isStopRequested?: boolean
  placeholder?: string
  /** When set with ``onControlledTextChange``, the field is controlled (branch edit). */
  controlledText?: string | null
  onControlledTextChange?: (text: string) => void
  /** Shown above the row while editing an earlier message. */
  editModeBanner?: { onCancel: () => void } | null
  /** When non-null, focuses the composer (stable per message being edited). */
  editingMessageId?: string | null
  /** Surface treatment of the composer container. */
  surfaceVariant?: 'docked' | 'floating'
}

export function ChatInput({
  onSend,
  onStop,
  disabled,
  isGenerating = false,
  isStopRequested = false,
  placeholder,
  controlledText,
  onControlledTextChange,
  editModeBanner,
  editingMessageId = null,
  surfaceVariant = 'docked',
}: ChatInputProps) {
  const [text, setText] = useState('')
  const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT)
  const [focused, setFocused] = useState(false)
  const [activeEditModeBanner, setActiveEditModeBanner] = useState(editModeBanner)
  const inputRef = useRef<TextInput>(null)
  const theme = useTheme()
  const focusAnim = useRef(new Animated.Value(0)).current
  const animatedInputHeight = useAnimatedNumber(inputHeight, INPUT_HEIGHT_TRANSITION_MS)
  const showEditModeBanner = !!editModeBanner
  const bannerMaxHeight = useAnimatedNumber(
    showEditModeBanner ? EDIT_MODE_BANNER_MAX_HEIGHT : 0,
    EDIT_MODE_BANNER_TRANSITION_MS
  )
  const { opacity: bannerOpacity, translateY: bannerTranslateY } = useVisibilityTransition({
    visible: showEditModeBanner,
    duration: EDIT_MODE_BANNER_TRANSITION_MS,
    hiddenOffsetY: 10,
  })

  useEffect(() => {
    if (editModeBanner) {
      setActiveEditModeBanner(editModeBanner)
      return
    }

    const clearBannerTimeoutId = setTimeout(() => {
      setActiveEditModeBanner(null)
    }, EDIT_MODE_BANNER_TRANSITION_MS)

    return () => clearTimeout(clearBannerTimeoutId)
  }, [editModeBanner])

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

  const isControlled =
    controlledText !== undefined && controlledText !== null && onControlledTextChange !== undefined
  const fieldValue = isControlled ? controlledText : text
  const setFieldValue = isControlled ? onControlledTextChange : setText

  useEffect(() => {
    if (!editingMessageId) return
    // Branch edit: user types in the highlighted bubble or here; do not steal focus
    // from the bubble TextInput on mount.
    if (isControlled) return
    const focusTimeoutId = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(focusTimeoutId)
  }, [editingMessageId, isControlled])

  useEffect(() => {
    if (!isControlled) {
      setInputHeight(MIN_INPUT_HEIGHT)
      return
    }

    if (controlledText === undefined || controlledText === null) return
    if (controlledText.length === 0) {
      setInputHeight(MIN_INPUT_HEIGHT)
    }
  }, [isControlled, controlledText])

  const handleSend = useCallback(() => {
    const trimmed = fieldValue.trim()
    if (!trimmed) return
    onSend(trimmed)
    if (!isControlled) {
      setText('')
      setInputHeight(MIN_INPUT_HEIGHT)
    }
  }, [fieldValue, onSend, isControlled])

  const handleChangeText = useCallback(
    (nextText: string) => {
      setFieldValue(nextText)
      if (nextText.length === 0) {
        setInputHeight(MIN_INPUT_HEIGHT)
      }
    },
    [setFieldValue]
  )

  const handleContentSizeChange = useCallback(
    (contentSizeEvent: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      const contentHeight = contentSizeEvent.nativeEvent.contentSize.height
      if (!contentHeight || contentHeight < 1) return
      const nextInputHeight = Math.min(
        MAX_INPUT_HEIGHT,
        Math.max(MIN_INPUT_HEIGHT, Math.ceil(contentHeight))
      )
      setInputHeight((previousHeight) =>
        previousHeight === nextInputHeight ? previousHeight : nextInputHeight
      )
    },
    []
  )

  const handleKeyPress = useCallback(
    (keyPressEvent: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (Platform.OS !== 'web') return
      const nativeEvent = keyPressEvent.nativeEvent as any
      if (nativeEvent.key === 'Enter' && !nativeEvent.shiftKey) {
        keyPressEvent.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const handlePhoto = () => {
    const alertFn =
      Platform.OS === 'web'
        ? (title: string, message: string) => window.alert(`${title}: ${message}`)
        : Alert.alert
    alertFn(
      'Photo Upload',
      'Camera integration coming soon. For now, describe the deal sheet in chat.'
    )
  }

  const handleVoice = () => {
    const alertFn =
      Platform.OS === 'web'
        ? (title: string, message: string) => window.alert(`${title}: ${message}`)
        : Alert.alert
    alertFn('Voice Mode', 'Voice input coming soon. Type your message for now.')
  }

  const hasText = fieldValue.trim().length > 0
  const showStopButton = isGenerating && !!onStop
  const showSendButton = hasText || !!editModeBanner
  const sendDisabled = disabled || !hasText
  const usesFloatingSurface = surfaceVariant === 'floating'

  return (
    <YStack width="100%">
      {activeEditModeBanner ? (
        <Animated.View
          style={{
            maxHeight: bannerMaxHeight,
            opacity: bannerOpacity,
            overflow: 'hidden',
            transform: [{ translateY: bannerTranslateY }],
          }}
        >
          <YStack
            paddingHorizontal="$3"
            paddingTop="$2"
            paddingBottom="$1"
            backgroundColor="$backgroundHover"
            borderTopWidth={usesFloatingSurface ? 0 : 1}
            borderTopColor="$borderColor"
          >
            <XStack alignItems="center" justifyContent="space-between" gap="$2">
              <Text fontSize={12} lineHeight={18} color="$placeholderColor" flex={1}>
                Press send to replace that message and continue the conversation from there.
              </Text>
              <TouchableOpacity
                onPress={activeEditModeBanner.onCancel}
                disabled={disabled}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                {...(Platform.OS === 'web'
                  ? ({ 'aria-label': 'Cancel editing message' } as any)
                  : { accessibilityLabel: 'Cancel editing message' })}
              >
                <XStack
                  width={44}
                  height={44}
                  borderRadius={100}
                  alignItems="center"
                  justifyContent="center"
                >
                  <X size={20} color="$placeholderColor" />
                </XStack>
              </TouchableOpacity>
            </XStack>
          </YStack>
        </Animated.View>
      ) : null}
      <XStack
        minHeight={PANEL_FOOTER_MIN_HEIGHT}
        paddingHorizontal="$3"
        paddingTop="$2"
        paddingBottom="$2"
        gap="$2"
        alignItems="flex-end"
        backgroundColor="$backgroundStrong"
        borderTopWidth={usesFloatingSurface ? 0 : 1}
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
            height: animatedInputHeight,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: animatedBorderColor,
            backgroundColor: theme.backgroundHover?.val as string,
            overflow: 'hidden',
            maxHeight: MAX_INPUT_HEIGHT,
          }}
        >
          <TextInput
            ref={inputRef}
            style={
              {
                fontSize: 15,
                lineHeight: 20,
                color: theme.color?.val as string,
                paddingHorizontal: 16,
                paddingTop: 12,
                paddingBottom: 12,
                height: inputHeight,
                minHeight: MIN_INPUT_HEIGHT,
                margin: 0,
                maxHeight: MAX_INPUT_HEIGHT,
                outlineWidth: 0,
                scrollbarWidth: 'thin',
                scrollbarColor: `${theme.placeholderColor?.val ?? palette.overlay} transparent`,
              } as any
            }
            placeholder={placeholder ?? 'Message...'}
            placeholderTextColor={theme.placeholderColor?.val as string}
            accessibilityLabel={
              editModeBanner
                ? 'Edit the highlighted message above; send applies your text and continues from there'
                : 'Message input'
            }
            value={fieldValue}
            onChangeText={handleChangeText}
            onContentSizeChange={handleContentSizeChange}
            onKeyPress={handleKeyPress}
            multiline
            textAlignVertical="top"
            scrollEnabled={inputHeight >= MAX_INPUT_HEIGHT}
            editable={!disabled}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
        </Animated.View>

        {showStopButton ? (
          <TouchableOpacity
            onPress={onStop}
            disabled={isStopRequested}
            activeOpacity={0.6}
            {...(Platform.OS === 'web'
              ? ({ 'aria-label': 'Stop generation' } as any)
              : {
                  accessibilityLabel: 'Stop generation',
                })}
          >
            <XStack
              width={44}
              height={44}
              borderRadius={100}
              backgroundColor="$backgroundHover"
              borderWidth={1}
              borderColor="$borderColor"
              alignItems="center"
              justifyContent="center"
              opacity={isStopRequested ? 0.45 : undefined}
            >
              <Square size={16} color="$placeholderColor" fill="$placeholderColor" />
            </XStack>
          </TouchableOpacity>
        ) : showSendButton ? (
          <TouchableOpacity
            onPress={handleSend}
            disabled={sendDisabled}
            activeOpacity={0.6}
            {...(Platform.OS === 'web'
              ? ({
                  'aria-label': editModeBanner ? 'Apply this edit from here' : 'Send message',
                } as any)
              : {
                  accessibilityLabel: editModeBanner ? 'Apply this edit from here' : 'Send message',
                })}
          >
            <XStack
              width={44}
              height={44}
              borderRadius={100}
              backgroundColor="$brand"
              alignItems="center"
              justifyContent="center"
              opacity={sendDisabled ? 0.45 : 1}
            >
              <Send size={20} color="$white" />
            </XStack>
          </TouchableOpacity>
        ) : (
          <VoiceButton onPress={handleVoice} />
        )}
      </XStack>
    </YStack>
  )
}
