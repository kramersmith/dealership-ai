import { memo, useEffect, useRef, useState } from 'react'
import {
  Animated,
  Platform,
  Pressable,
  TextInput,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
  type TextInputKeyPressEventData,
} from 'react-native'
import { YStack, XStack, Text, Theme, useTheme, Button } from 'tamagui'
import { Pencil, RefreshCw, Undo2 } from '@tamagui/lucide-icons'
import type { Message } from '@/lib/types'
import { palette } from '@/lib/theme/tokens'
import {
  APP_NAME,
  CHAT_BUBBLE_MAX_WIDTH,
  DESKTOP_ASSISTANT_BUBBLE_MAX_WIDTH,
} from '@/lib/constants'
import { useIconEntrance, useSlideIn } from '@/hooks/useAnimatedValue'
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

const EDITABLE_BUBBLE_LINE_HEIGHT = 22
const EDITABLE_BUBBLE_MAX_HEIGHT = 280

function formatUsageCount(value: number) {
  if (value >= 1000) {
    const compact = value / 1000
    return `${compact >= 10 ? Math.round(compact) : compact.toFixed(1)}k`
  }
  return String(value)
}

function StatusBadge({ label }: { label: string }) {
  return (
    <XStack
      minHeight={22}
      paddingHorizontal="$2"
      borderRadius="$2"
      backgroundColor="$backgroundHover"
      borderWidth={1}
      borderColor="$borderColor"
      alignItems="center"
      justifyContent="center"
    >
      <Text fontSize={10} lineHeight={14} color="$placeholderColor">
        {label}
      </Text>
    </XStack>
  )
}

function HiddenSenderLabel({ role, createdAt }: { role: Message['role']; createdAt: string }) {
  if (Platform.OS !== 'web') {
    return null
  }

  return (
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
      {role === 'user' ? 'You' : APP_NAME}
      {' — '}
      {new Date(createdAt).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })}
      {'\n'}
    </Text>
  )
}

function BubbleAttachmentPreview({ isUser }: { isUser: boolean }) {
  return (
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
  )
}

function EditableBubbleText({
  value,
  inputRef,
  onChangeText,
  onKeyPress,
}: {
  value: string
  inputRef: React.RefObject<TextInput | null>
  onChangeText: (text: string) => void
  onKeyPress: (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => void
}) {
  const [isOverflowing, setIsOverflowing] = useState(false)

  const handleContentSizeChange = (
    contentSizeEvent: NativeSyntheticEvent<TextInputContentSizeChangeEventData>
  ) => {
    const contentHeight = contentSizeEvent.nativeEvent.contentSize.height
    setIsOverflowing(contentHeight > EDITABLE_BUBBLE_MAX_HEIGHT)
  }

  return (
    <YStack
      position="relative"
      minHeight={EDITABLE_BUBBLE_LINE_HEIGHT}
      maxHeight={EDITABLE_BUBBLE_MAX_HEIGHT}
      overflow="hidden"
    >
      <Text
        flexShrink={1}
        fontSize={15}
        lineHeight={EDITABLE_BUBBLE_LINE_HEIGHT}
        color="$white"
        opacity={0}
        style={{ pointerEvents: 'none' } as any}
      >
        {value || ' '}
      </Text>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        onKeyPress={onKeyPress}
        onContentSizeChange={handleContentSizeChange}
        multiline
        scrollEnabled={isOverflowing}
        textAlignVertical="top"
        accessibilityLabel="Edit message text"
        style={
          {
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            fontSize: 15,
            lineHeight: EDITABLE_BUBBLE_LINE_HEIGHT,
            color: palette.white,
            backgroundColor: 'transparent',
            padding: 0,
            margin: 0,
            minHeight: EDITABLE_BUBBLE_LINE_HEIGHT,
            maxHeight: EDITABLE_BUBBLE_MAX_HEIGHT,
            borderWidth: 0,
            borderRadius: 0,
            outlineStyle: 'none',
            outlineWidth: 0,
            ...(Platform.OS === 'web'
              ? {
                  appearance: 'none',
                  WebkitAppearance: 'none',
                }
              : null),
          } as any
        }
        placeholderTextColor={palette.whiteTint55}
      />
    </YStack>
  )
}

function AnimatedEditStateIcon({ isEditing, color }: { isEditing: boolean; color: string }) {
  const entrance = useIconEntrance(true)
  const Icon = isEditing ? Pencil : Undo2

  return (
    <Animated.View
      style={{
        opacity: entrance.opacity,
        transform: [{ rotate: entrance.rotate }],
      }}
    >
      <Icon size={isEditing ? 13 : 14} color={color} />
    </Animated.View>
  )
}

function InlineEditControl({
  isEditing,
  onPress,
  color,
}: {
  isEditing: boolean
  onPress?: () => void
  color: string
}) {
  if (!onPress && !isEditing) {
    return null
  }

  const accessibilityProps = isEditing
    ? Platform.OS === 'web'
      ? ({ role: 'status', 'aria-label': 'Editing this message' } as any)
      : { accessibilityLabel: 'Editing this message' }
    : Platform.OS === 'web'
      ? ({
          'aria-label': 'Revert to this message and continue the conversation from here',
        } as any)
      : {
          accessibilityLabel: 'Revert to this message and continue the conversation from here',
        }

  return (
    <Pressable
      onPress={isEditing ? undefined : onPress}
      disabled={isEditing || !onPress}
      hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }}
      style={({ pressed }) =>
        ({
          justifyContent: 'center',
          alignItems: 'center',
          width: 22,
          height: 22,
          borderRadius: 11,
          opacity: pressed && !isEditing ? 0.78 : 1,
          backgroundColor: 'transparent',
          ...(Platform.OS === 'web'
            ? {
                cursor: isEditing || !onPress ? 'default' : 'pointer',
              }
            : null),
        }) as any
      }
      {...accessibilityProps}
    >
      <XStack width={22} height={22} alignItems="center" justifyContent="center">
        <AnimatedEditStateIcon
          key={isEditing ? 'editing' : 'idle'}
          isEditing={isEditing}
          color={color}
        />
      </XStack>
    </Pressable>
  )
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
  const railHorizontalPadding = isDesktop ? '$0' : '$4'
  const bubbleMaxWidth =
    !isUser && !isSystem && isDesktop ? DESKTOP_ASSISTANT_BUBBLE_MAX_WIDTH : CHAT_BUBBLE_MAX_WIDTH
  const assistantColors = getAssistantMarkdownColors(theme)
  const usageLabel =
    !isUser && message.usage
      ? `${message.usage.requests} req · ${formatUsageCount(message.usage.inputTokens)} in · ${formatUsageCount(message.usage.outputTokens)} out`
      : null
  const assistantMessageMetaLabel =
    !isUser && !isSystem
      ? `${new Date(message.createdAt).toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        })}${usageLabel ? ` · ${usageLabel}` : ''}`
      : null
  const userMessageStatusLabel = isUser
    ? message.status === 'queued'
      ? 'Queued'
      : message.status === 'sending'
        ? 'Sending now'
        : null
    : null
  const canPressBubbleToEdit = isUser && !!onStartEdit && !isEditTarget
  const userMetaColor = theme.placeholderColor?.val as string

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
  const hiddenSenderLabel = <HiddenSenderLabel role={message.role} createdAt={message.createdAt} />
  const attachmentPreview = message.imageUri ? <BubbleAttachmentPreview isUser={isUser} /> : null

  const userBubbleShell = isUser ? (
    <YStack
      position="relative"
      backgroundColor="$brand"
      borderRadius={useInlineAssistantLayout ? 0 : '$4'}
      borderBottomRightRadius="$1"
      borderBottomLeftRadius="$4"
      paddingLeft={useInlineAssistantLayout ? '$0' : '$4'}
      paddingRight={useInlineAssistantLayout ? '$0' : '$4'}
      paddingVertical={useInlineAssistantLayout ? '$2' : '$3'}
    >
      {isEditTarget ? (
        <YStack
          position="absolute"
          top={0}
          right={0}
          bottom={0}
          left={0}
          borderWidth={2}
          borderRadius={useInlineAssistantLayout ? 0 : '$4'}
          borderBottomRightRadius="$1"
          borderBottomLeftRadius="$4"
          style={{ borderColor: palette.whiteTint85, pointerEvents: 'none' } as const}
        />
      ) : null}
      {hiddenSenderLabel}
      {attachmentPreview}
      {message.quotedCard ? <QuotedCardPreview card={message.quotedCard} /> : null}
      {isEditTarget && onEditDraftChange ? (
        <EditableBubbleText
          value={editedBodyText ?? ''}
          inputRef={bubbleInputRef}
          onChangeText={onEditDraftChange}
          onKeyPress={handleBubbleEditKeyPress}
        />
      ) : (
        <Text flexShrink={1} fontSize={15} lineHeight={22} color="$white">
          {userVisibleBody}
        </Text>
      )}
      {message.status === 'failed' ? <FailedMessageFooter messageId={message.id} /> : null}
    </YStack>
  ) : null

  const assistantBubbleShell = !isUser ? (
    <YStack
      width="100%"
      backgroundColor={useInlineAssistantLayout ? 'transparent' : '$backgroundStrong'}
      borderRadius={useInlineAssistantLayout ? 0 : '$4'}
      borderBottomRightRadius="$4"
      borderBottomLeftRadius={useInlineAssistantLayout ? 0 : '$1'}
      paddingLeft={useInlineAssistantLayout ? '$0' : '$4'}
      paddingRight={useInlineAssistantLayout ? '$0' : '$4'}
      paddingVertical={useInlineAssistantLayout ? '$2' : '$3'}
    >
      {hiddenSenderLabel}
      {attachmentPreview}
      <YStack>
        <ChatMarkdown style={markdownStyles}>{message.content}</ChatMarkdown>
      </YStack>
    </YStack>
  ) : null

  if (isSystem) {
    return (
      <Animated.View style={{ opacity, transform: [{ translateY }] }}>
        <XStack
          justifyContent="center"
          paddingHorizontal={railHorizontalPadding}
          paddingVertical="$1"
        >
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
        paddingHorizontal={railHorizontalPadding}
        paddingVertical={isUser ? '$1' : '$0.5'}
        alignItems={isUser ? 'flex-end' : 'flex-start'}
        gap="$1"
      >
        <YStack
          style={{ maxWidth: `min(100%, ${bubbleMaxWidth}px)` } as any}
          flexShrink={1}
          alignItems={isUser ? 'flex-end' : 'stretch'}
          width={isUser ? undefined : '100%'}
        >
          {isUser ? (
            canPressBubbleToEdit ? (
              <Pressable
                onPress={onStartEdit}
                style={({ pressed }) =>
                  ({
                    opacity: pressed ? 0.96 : 1,
                    ...(Platform.OS === 'web'
                      ? {
                          cursor: 'pointer',
                        }
                      : null),
                  }) as any
                }
                {...(Platform.OS === 'web'
                  ? ({
                      'aria-label':
                        'Revert to this message and continue the conversation from here',
                    } as any)
                  : {
                      accessibilityLabel:
                        'Revert to this message and continue the conversation from here',
                    })}
              >
                {userBubbleShell}
              </Pressable>
            ) : (
              userBubbleShell
            )
          ) : (
            assistantBubbleShell
          )}
          {!isUser && assistantMessageMetaLabel ? (
            <XStack
              marginTop="$1"
              width="100%"
              justifyContent="flex-start"
              alignItems="center"
              gap="$1.5"
              flexWrap="wrap"
            >
              <Text fontSize={10} color="$placeholderColor">
                {assistantMessageMetaLabel}
              </Text>
              {message.completionStatus === 'interrupted' ? <StatusBadge label="Stopped" /> : null}
            </XStack>
          ) : null}
          {isUser ? (
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
              <InlineEditControl
                isEditing={isEditTarget}
                onPress={onStartEdit}
                color={userMetaColor}
              />
              {userMessageStatusLabel ? <StatusBadge label={userMessageStatusLabel} /> : null}
            </XStack>
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
