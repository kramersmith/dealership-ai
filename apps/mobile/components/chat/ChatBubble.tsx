import { memo, useEffect, useRef } from 'react'
import {
  Animated,
  Platform,
  TextInput,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native'
import { YStack, XStack, Text, Theme, useTheme, Button } from 'tamagui'
import { Pencil, RefreshCw, Undo2 } from '@tamagui/lucide-icons'
import type { Message } from '@/lib/types'
import { palette } from '@/lib/theme/tokens'
import { APP_NAME, CHAT_BUBBLE_MAX_WIDTH } from '@/lib/constants'
import { useSlideIn } from '@/hooks/useAnimatedValue'
import { useScreenWidth } from '@/hooks/useScreenWidth'
import { useChatStore } from '@/stores/chatStore'
import { buildMarkdownStyles, getAssistantMarkdownColors } from './markdownStyles'
import { ChatMarkdown } from './markdownRenderer'
import { QuotedCardPreview } from './QuotedCardPreview'

interface ChatBubbleProps {
  message: Message
  skipAnimation?: boolean
  /** Edit-from-here (branch) — only passed for eligible user messages. */
  onStartEdit?: () => void
  /** Composer is editing this user message — show a light ring on the bubble. */
  isEditTarget?: boolean
  /** Live text from the composer while this user message is being edited. */
  editedBodyText?: string
  /** While editing, updates shared draft (inline bubble field). */
  onEditDraftChange?: (text: string) => void
  /** Web: Enter without Shift sends branch edit (same as composer send). */
  onBranchEditSubmitFromBubble?: () => void
}

function formatUsageCount(value: number) {
  if (value >= 1000) {
    const compact = value / 1000
    return `${compact >= 10 ? Math.round(compact) : compact.toFixed(1)}k`
  }
  return String(value)
}

export const ChatBubble = memo(function ChatBubble({
  message,
  skipAnimation = false,
  onStartEdit,
  isEditTarget = false,
  editedBodyText,
  onEditDraftChange,
  onBranchEditSubmitFromBubble,
}: ChatBubbleProps) {
  const bubbleInputRef = useRef<TextInput>(null)
  const isUser = message.role === 'user'
  const userVisibleBody =
    isUser && typeof editedBodyText === 'string' ? editedBodyText : message.content
  const isSystem = message.role === 'system'
  const { opacity, translateY } = useSlideIn(skipAnimation ? 0 : 250)
  const theme = useTheme()
  const { isDesktop } = useScreenWidth()
  const useInlineAssistantLayout = !isUser && !isSystem && !isDesktop
  const assistantColors = getAssistantMarkdownColors(theme)
  const usageLabel =
    !isUser && message.usage
      ? `${message.usage.requests} req · ${formatUsageCount(message.usage.inputTokens)} in · ${formatUsageCount(message.usage.outputTokens)} out`
      : null

  useEffect(() => {
    if (!isUser || !isEditTarget || !onEditDraftChange) return
    const focusBubble = () => bubbleInputRef.current?.focus()
    const earlyFocusTimeoutId = setTimeout(focusBubble, 50)
    const lateFocusTimeoutId = setTimeout(focusBubble, 160)
    return () => {
      clearTimeout(earlyFocusTimeoutId)
      clearTimeout(lateFocusTimeoutId)
    }
  }, [isUser, isEditTarget, onEditDraftChange, message.id])

  const handleBubbleEditKeyPress = (
    keyPressEvent: NativeSyntheticEvent<TextInputKeyPressEventData>
  ) => {
    if (Platform.OS !== 'web' || !onBranchEditSubmitFromBubble) return
    const nativeEvent = keyPressEvent.nativeEvent as { key?: string; shiftKey?: boolean }
    if (nativeEvent.key === 'Enter' && !nativeEvent.shiftKey) {
      keyPressEvent.preventDefault()
      onBranchEditSubmitFromBubble()
    }
  }

  // User bubbles use white-on-brand; assistant bubbles use theme-derived colors
  const markdownStyles = buildMarkdownStyles(
    isUser
      ? {
          textColor: palette.white,
          bodyTextColor: palette.white,
          codeBg: palette.brandPressed,
          subtleSurface: palette.whiteTint10,
          tableBorderColor: palette.whiteTint22,
          tableHeaderBg: palette.whiteTint12,
          hrColor: palette.whiteTint20,
        }
      : assistantColors
  )

  if (isSystem) {
    return (
      <Animated.View style={{ opacity, transform: [{ translateY }] }}>
        <XStack justifyContent="center" paddingHorizontal="$4" paddingVertical="$1">
          <Theme name="warning">
            <YStack
              maxWidth={CHAT_BUBBLE_MAX_WIDTH}
              width="100%"
              backgroundColor="$background"
              borderRadius="$3"
              paddingHorizontal="$3"
              paddingVertical="$2.5"
              borderWidth={1}
              borderColor="$borderColor"
            >
              <Text fontSize={13} lineHeight={19} color="$color" textAlign="center">
                {message.content}
              </Text>
              <Text fontSize={10} color="$placeholderColor" textAlign="center" marginTop="$1">
                {new Date(message.createdAt).toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </Text>
            </YStack>
          </Theme>
        </XStack>
      </Animated.View>
    )
  }

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <XStack
        justifyContent={isUser ? 'flex-end' : 'flex-start'}
        paddingHorizontal="$4"
        paddingVertical={isUser ? '$1' : '$0.5'}
        alignItems={isUser ? 'flex-end' : 'flex-start'}
        gap="$1"
      >
        <YStack
          style={{ maxWidth: `min(100%, ${CHAT_BUBBLE_MAX_WIDTH}px)` } as any}
          flexShrink={1}
          alignItems={isUser ? 'flex-end' : 'stretch'}
          width={isUser && isEditTarget ? '100%' : isUser ? undefined : '100%'}
        >
          <YStack
            {...(!isUser || (isUser && isEditTarget) ? ({ width: '100%' } as const) : {})}
            backgroundColor={
              isUser ? '$brand' : useInlineAssistantLayout ? 'transparent' : '$backgroundStrong'
            }
            borderRadius={useInlineAssistantLayout ? 0 : '$4'}
            borderBottomRightRadius={isUser ? '$1' : '$4'}
            borderBottomLeftRadius={isUser ? '$4' : useInlineAssistantLayout ? 0 : '$1'}
            paddingHorizontal={useInlineAssistantLayout ? '$0' : '$4'}
            paddingVertical={useInlineAssistantLayout ? '$2' : '$3'}
            borderWidth={isUser && isEditTarget ? 2 : 0}
            borderColor="transparent"
            style={
              isUser && isEditTarget ? ({ borderColor: palette.whiteTint85 } as const) : undefined
            }
          >
            {/* Hidden sender label — invisible but included when copy-pasting (web) */}
            {Platform.OS === 'web' && (
              <Text
                style={
                  {
                    position: 'absolute',
                    width: 1,
                    height: 1,
                    margin: -1,
                    padding: 0,
                    overflow: 'hidden',
                    clip: 'rect(0, 0, 0, 0)',
                    whiteSpace: 'nowrap',
                    borderWidth: 0,
                    opacity: 0,
                    pointerEvents: 'none',
                    fontSize: 1,
                    lineHeight: 1,
                  } as any
                }
                aria-hidden
              >
                {isUser ? 'You' : APP_NAME}
                {' — '}
                {new Date(message.createdAt).toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
                {'\n'}
              </Text>
            )}
            {message.imageUri && (
              <YStack
                width="100%"
                height={150}
                borderRadius="$2"
                backgroundColor={isUser ? '$brandPressed' : '$backgroundHover'}
                marginBottom="$2"
                alignItems="center"
                justifyContent="center"
              >
                <Text fontSize={12} color={isUser ? '$brandLight' : '$placeholderColor'}>
                  [Photo attached]
                </Text>
              </YStack>
            )}
            {isUser && message.quotedCard && <QuotedCardPreview card={message.quotedCard} />}
            {isUser ? (
              isEditTarget && onEditDraftChange ? (
                <TextInput
                  ref={bubbleInputRef}
                  value={editedBodyText ?? ''}
                  onChangeText={onEditDraftChange}
                  onKeyPress={handleBubbleEditKeyPress}
                  multiline
                  scrollEnabled
                  textAlignVertical="top"
                  accessibilityLabel="Edit message text"
                  style={
                    {
                      fontSize: 15,
                      lineHeight: 22,
                      color: palette.white,
                      padding: 0,
                      margin: 0,
                      minHeight: 22,
                      maxHeight: 280,
                      width: '100%',
                      outlineWidth: 0,
                    } as any
                  }
                  placeholderTextColor={palette.whiteTint55}
                />
              ) : (
                <Text fontSize={15} lineHeight={22} color="$white">
                  {userVisibleBody}
                </Text>
              )
            ) : (
              <YStack>
                <ChatMarkdown style={markdownStyles}>{message.content}</ChatMarkdown>
              </YStack>
            )}
            {!isUser && (
              <Text fontSize={10} color="$placeholderColor" marginTop="$1" textAlign="left">
                {new Date(message.createdAt).toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
                {usageLabel ? ` · ${usageLabel}` : ''}
              </Text>
            )}
            {isUser && message.status === 'failed' && (
              <FailedMessageFooter messageId={message.id} />
            )}
          </YStack>
          {isUser && (onStartEdit || isEditTarget) ? (
            <XStack
              marginTop="$1"
              width="100%"
              alignItems="center"
              justifyContent="flex-end"
              flexWrap="wrap"
              gap="$1.5"
            >
              <Text fontSize={10} lineHeight={16} color="$placeholderColor">
                {new Date(message.createdAt).toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </Text>
              {isEditTarget ? (
                <XStack
                  minHeight={44}
                  paddingHorizontal="$3"
                  gap="$1.5"
                  borderRadius="$3"
                  backgroundColor="transparent"
                  borderWidth={1}
                  borderColor="$brand"
                  alignItems="center"
                  justifyContent="center"
                  opacity={0.92}
                  {...(Platform.OS === 'web'
                    ? ({ role: 'status', 'aria-label': 'Editing this message' } as any)
                    : { accessibilityLabel: 'Editing this message' })}
                >
                  <Pencil size={16} color="$brand" />
                  <Text color="$brand" fontWeight="600" fontSize={13}>
                    Editing
                  </Text>
                </XStack>
              ) : (
                <Button
                  size="$3"
                  minHeight={44}
                  paddingHorizontal="$3"
                  borderRadius="$3"
                  backgroundColor="transparent"
                  borderWidth={1}
                  borderColor="$brand"
                  pressStyle={{ backgroundColor: '$brandSubtle' }}
                  onPress={onStartEdit}
                  {...(Platform.OS === 'web'
                    ? ({
                        hoverStyle: { backgroundColor: '$backgroundHover' },
                        cursor: 'pointer',
                        'aria-label':
                          'Revert to this message and continue the conversation from here',
                      } as any)
                    : {
                        accessibilityLabel:
                          'Revert to this message and continue the conversation from here',
                      })}
                >
                  <XStack gap="$1.5" alignItems="center" justifyContent="center">
                    <Undo2 size={16} color="$brand" />
                    <Button.Text color="$brand" fontWeight="600" fontSize={13}>
                      Edit from here
                    </Button.Text>
                  </XStack>
                </Button>
              )}
            </XStack>
          ) : isUser ? (
            <Text
              fontSize={10}
              color="$placeholderColor"
              marginTop="$1"
              textAlign="right"
              width="100%"
            >
              {new Date(message.createdAt).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </Text>
          ) : null}
        </YStack>
      </XStack>
    </Animated.View>
  )
})

function FailedMessageFooter({ messageId }: { messageId: string }) {
  const retrySend = useChatStore((state) => state.retrySend)

  return (
    <YStack marginTop="$3" paddingTop="$3" gap="$3" width="100%" alignItems="stretch">
      <YStack height={1} width="100%" backgroundColor="$white" opacity={0.22} />
      <YStack gap="$2.5" alignItems="stretch">
        <Text fontSize={12} lineHeight={18} color="$white" opacity={0.92} textAlign="center">
          This message didn&apos;t send.
        </Text>
        <Button
          size="$4"
          minHeight={44}
          width="100%"
          backgroundColor="$white"
          borderRadius="$3"
          onPress={() => retrySend(messageId)}
          pressStyle={{ opacity: 0.9, scale: 0.99 }}
          {...(Platform.OS === 'web' ? { hoverStyle: { opacity: 0.96 } } : {})}
          {...(Platform.OS === 'web'
            ? ({ 'aria-label': 'Try again to send this message' } as any)
            : { accessibilityLabel: 'Try again to send this message' })}
        >
          <XStack gap="$2" alignItems="center" justifyContent="center">
            <RefreshCw size={18} color="$brand" />
            <Button.Text color="$brand" fontWeight="700" fontSize={15}>
              Try again
            </Button.Text>
          </XStack>
        </Button>
      </YStack>
    </YStack>
  )
}
