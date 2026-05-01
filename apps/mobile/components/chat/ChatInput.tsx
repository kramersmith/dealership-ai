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
import { XStack, YStack, Text, useTheme, useThemeName } from 'tamagui'
import { Mic, Paperclip, Send, Square, X } from '@tamagui/lucide-icons'
import { palette } from '@/lib/theme/tokens'
import { useAnimatedNumber, useVisibilityTransition } from '@/hooks/useAnimatedValue'

// One line of 14px text at lineHeight 20 + paddingTop 6 + paddingBottom 6 = 32.
// Use 36 for a touch of breathing room so the textarea has no intrinsic overflow.
const MIN_INPUT_HEIGHT = 36
const MAX_INPUT_HEIGHT = 128
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
  const themeName = useThemeName()
  const isCopilotChat = themeName === 'dark_copilot'
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
      duration: 180,
      useNativeDriver: false,
    }).start()
  }, [focused, focusAnim])

  // Source: bg-slate-900 border-white/10, focus border emerald-400/40
  const idleBorder = palette.ghostBorder
  const focusBorder = palette.copilotEmeraldBorder40
  const animatedBorderColor = focusAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [idleBorder, focusBorder],
  })

  const isControlled =
    controlledText !== undefined && controlledText !== null && onControlledTextChange !== undefined
  const fieldValue = isControlled ? controlledText : text
  const setFieldValue = isControlled ? onControlledTextChange : setText

  useEffect(() => {
    if (!editingMessageId) return
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
  const sendDisabled = disabled || !hasText
  // Source composer: outer band p-4 border-t border-white/10 bg-slate-950/40
  const composerBandBg = isCopilotChat ? 'rgba(2, 6, 23, 0.40)' : (palette.copilotChromeTray as any)
  const composerBandBorder = isCopilotChat ? 'rgba(255, 255, 255, 0.16)' : '$borderColor'

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
            paddingHorizontal={16}
            paddingTop={10}
            paddingBottom={10}
            // Lighter slate tint so the edit-mode banner reads as its own band
            // distinct from the composer below.
            backgroundColor="rgba(51, 65, 85, 0.45)"
            borderTopWidth={1}
            borderTopColor={palette.ghostBgHover}
          >
            <XStack alignItems="center" justifyContent="space-between" gap="$2">
              <Text fontSize={12} lineHeight={18} color={palette.slate300} flex={1}>
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
                  width={28}
                  height={28}
                  borderRadius={14}
                  alignItems="center"
                  justifyContent="center"
                >
                  <X size={14} color={palette.slate400} />
                </XStack>
              </TouchableOpacity>
            </XStack>
          </YStack>
        </Animated.View>
      ) : null}
      <YStack
        paddingHorizontal={16}
        paddingTop={16}
        paddingBottom={16}
        backgroundColor={composerBandBg}
        // Source composer always has `border-t border-white/10` separating it
        // from the message list above.
        borderTopWidth={1}
        borderTopColor={composerBandBorder}
      >
        {/* Source: flex items-center gap-2 bg-slate-900 border border-white/10 rounded-2xl px-3 py-2 focus-within:border-emerald-400/40 */}
        <Animated.View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: palette.slate900,
            borderWidth: 1,
            borderRadius: 16,
            borderColor: animatedBorderColor,
            paddingHorizontal: 12,
            paddingVertical: 8,
          }}
        >
          {/* Paperclip — 36×36 to match the send button */}
          <TouchableOpacity
            onPress={handlePhoto}
            activeOpacity={0.6}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            {...(Platform.OS === 'web'
              ? ({ 'aria-label': 'Attach photo (coming soon)' } as any)
              : { accessibilityLabel: 'Attach photo (coming soon)' })}
          >
            <Paperclip size={16} color={palette.slate500} />
          </TouchableOpacity>

          {/* Textarea — flex-1 resize-none bg-transparent text-sm text-slate-100 placeholder:text-slate-600 max-h-32 */}
          <Animated.View
            style={{
              flex: 1,
              height: animatedInputHeight,
              maxHeight: MAX_INPUT_HEIGHT,
              minHeight: MIN_INPUT_HEIGHT,
              justifyContent: 'flex-start',
            }}
          >
            <TextInput
              ref={inputRef}
              style={
                {
                  fontSize: 14,
                  lineHeight: 20,
                  color: palette.slate100,
                  paddingTop: 6,
                  paddingBottom: 6,
                  paddingHorizontal: 0,
                  height: inputHeight,
                  minHeight: MIN_INPUT_HEIGHT,
                  margin: 0,
                  maxHeight: MAX_INPUT_HEIGHT,
                  backgroundColor: 'transparent',
                  outlineWidth: 0,
                  // Default browser scrollbar behavior — only renders when content
                  // actually overflows the max-height. Setting `scrollbar-width: thin`
                  // forced a gutter even on a one-line input.
                  overflowY: 'auto',
                  scrollbarColor: `${theme.placeholderColor?.val ?? palette.overlay} transparent`,
                } as any
              }
              placeholder={
                placeholder ?? "Ask your copilot… (e.g., 'Is $86,900 a good OTD price?')"
              }
              placeholderTextColor={palette.slate600}
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

          {/* Mic — same 36×36 as paperclip and send */}
          <TouchableOpacity
            onPress={handleVoice}
            activeOpacity={0.6}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            {...(Platform.OS === 'web'
              ? ({ 'aria-label': 'Voice input (coming soon)' } as any)
              : { accessibilityLabel: 'Voice input (coming soon)' })}
          >
            <Mic size={16} color={palette.slate500} />
          </TouchableOpacity>

          {/* Send / Stop — h-9 w-9 rounded-xl */}
          {showStopButton ? (
            <TouchableOpacity
              onPress={onStop}
              disabled={isStopRequested}
              activeOpacity={0.6}
              {...(Platform.OS === 'web'
                ? ({ 'aria-label': 'Stop generation' } as any)
                : { accessibilityLabel: 'Stop generation' })}
            >
              <XStack
                width={36}
                height={36}
                borderRadius={12}
                backgroundColor={palette.slate800}
                alignItems="center"
                justifyContent="center"
                opacity={isStopRequested ? 0.45 : 1}
              >
                <Square size={14} color={palette.slate400} fill={palette.slate400} />
              </XStack>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={handleSend}
              disabled={sendDisabled}
              activeOpacity={0.6}
              {...(Platform.OS === 'web'
                ? ({
                    'aria-label': editModeBanner ? 'Apply this edit from here' : 'Send message',
                  } as any)
                : {
                    accessibilityLabel: editModeBanner
                      ? 'Apply this edit from here'
                      : 'Send message',
                  })}
            >
              <XStack
                width={36}
                height={36}
                borderRadius={12}
                backgroundColor={sendDisabled ? palette.slate800 : palette.copilotEmerald}
                alignItems="center"
                justifyContent="center"
              >
                <Send
                  size={16}
                  color={sendDisabled ? palette.slate600 : palette.copilotBackground}
                />
              </XStack>
            </TouchableOpacity>
          )}
        </Animated.View>
      </YStack>
    </YStack>
  )
}
