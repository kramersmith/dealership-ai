import { useRef, useEffect, useMemo, memo, type ReactNode } from 'react'
import { ScrollView, Animated } from 'react-native'
import { YStack, XStack, Text, useTheme, useThemeName } from 'tamagui'
import { palette } from '@/lib/theme/tokens'
import type { Message, VinAssistItem } from '@/lib/types'
import { isServerMessageId } from '@/stores/chatStore'
import { useFadeIn } from '@/hooks/useAnimatedValue'
import { useScreenWidth } from '@/hooks/useScreenWidth'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { ChatBubble } from './ChatBubble'
import { StreamingBubble } from './StreamingBubble'
import { VinAssistCard } from './VinAssistCard'
import { MultiVinAssistCard } from './MultiVinAssistCard'

/** Returns the ID of a message that was just promoted from StreamingBubble,
 *  so ChatBubble can skip its entrance animation (the text was already visible). */
function useJustFinalizedId(messages: Message[], streamingText: string) {
  const prevRef = useRef({ msgCount: messages.length, wasStreaming: false })
  const prev = prevRef.current

  const justFinalized =
    prev.wasStreaming && !streamingText && messages.length > prev.msgCount
      ? (messages[messages.length - 1]?.id ?? null)
      : null

  useEffect(() => {
    prevRef.current = { msgCount: messages.length, wasStreaming: streamingText.length > 0 }
  })

  return justFinalized
}

/** Animated bouncing dots — shows while AI is thinking before streaming starts */
function TypingIndicator() {
  const dot1 = useRef(new Animated.Value(0)).current
  const dot2 = useRef(new Animated.Value(0)).current
  const dot3 = useRef(new Animated.Value(0)).current
  const fadeIn = useFadeIn(200)
  const theme = useTheme()
  const themeName = useThemeName()
  const isCopilotChat = themeName === 'dark_copilot'
  const { isDesktop } = useScreenWidth()
  const dotColor = isCopilotChat ? palette.copilotPurple : (theme.placeholderColor?.val as string)
  const railHorizontalPadding = isDesktop ? '$0' : '$4'

  useEffect(() => {
    const animate = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(dot, {
            toValue: -4,
            duration: 300,
            delay,
            useNativeDriver: USE_NATIVE_DRIVER,
          }),
          Animated.timing(dot, {
            toValue: 0,
            duration: 300,
            useNativeDriver: USE_NATIVE_DRIVER,
          }),
        ])
      )

    const animations = [animate(dot1, 0), animate(dot2, 150), animate(dot3, 300)]
    animations.forEach((animation) => animation.start())
    return () => animations.forEach((animation) => animation.stop())
  }, [dot1, dot2, dot3])

  return (
    <Animated.View style={{ opacity: fadeIn }}>
      <XStack padding={railHorizontalPadding} alignItems="flex-start" paddingLeft="$6">
        <YStack
          flex={isCopilotChat ? 1 : undefined}
          backgroundColor={
            isCopilotChat ? (palette.copilotChatAssistantBg as any) : '$backgroundStrong'
          }
          borderRadius={16}
          paddingHorizontal="$3"
          paddingVertical="$2.5"
          borderWidth={isCopilotChat ? 1 : 0}
          borderColor={isCopilotChat ? (palette.copilotChatAssistantBorder as any) : 'transparent'}
          gap="$2"
        >
          <XStack gap="$1.5" alignItems="center">
            {[dot1, dot2, dot3].map((dot, i) => (
              <Animated.View
                key={i}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: dotColor,
                  transform: [{ translateY: dot }],
                }}
              />
            ))}
          </XStack>
          {isCopilotChat ? (
            <Text
              fontSize={11}
              fontStyle="italic"
              color="$placeholderColor"
              lineHeight={16}
              numberOfLines={2}
            >
              Reviewing your deal context…
            </Text>
          ) : null}
        </YStack>
      </XStack>
    </Animated.View>
  )
}

function RetryingIndicator() {
  const fadeIn = useFadeIn(200)
  const { isDesktop } = useScreenWidth()
  const railHorizontalPadding = isDesktop ? '$0' : '$4'

  return (
    <Animated.View style={{ opacity: fadeIn }}>
      <YStack padding={railHorizontalPadding} alignItems="flex-start" paddingLeft="$6">
        <XStack
          backgroundColor="$backgroundStrong"
          borderRadius={16}
          paddingHorizontal="$3"
          paddingVertical="$2.5"
          alignItems="center"
        >
          <Text fontSize={13} color="$placeholderColor">
            Retrying...
          </Text>
        </XStack>
      </YStack>
    </Animated.View>
  )
}

interface ChatMessageListProps {
  messages: Message[]
  vinAssistItems?: VinAssistItem[]
  isSending: boolean
  isRetrying?: boolean
  streamingText?: string
  topPadding?: number
  bottomPadding?: number
  footer?: ReactNode
  scrollbarOpacity?: number
  /** When set, user bubbles with server IDs show an edit affordance (branch from here). */
  onStartEditUserMessage?: (messageId: string) => void
  /** Message id whose text is open in the composer (scroll + highlight). */
  editingUserMessageId?: string | null
  /** Draft text for `editingUserMessageId` — shown live in that bubble. */
  editingDraft?: string
  /** Live-update draft while editing (inline bubble + composer share state). */
  onEditingUserMessageDraftChange?: (text: string) => void
  /** Web: Enter in the bubble submits the branch edit (same as send). */
  onBranchEditSubmitFromBubble?: () => void
}

function withAlpha(color: string, alpha: number) {
  const normalizedAlpha = Math.max(0, Math.min(1, alpha))

  if (color.startsWith('rgba(')) {
    return color.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, (_, r, g, b) => {
      return `rgba(${r.trim()}, ${g.trim()}, ${b.trim()}, ${normalizedAlpha})`
    })
  }

  if (color.startsWith('rgb(')) {
    return color.replace(/rgb\(([^,]+),([^,]+),([^)]+)\)/, (_, r, g, b) => {
      return `rgba(${r.trim()}, ${g.trim()}, ${b.trim()}, ${normalizedAlpha})`
    })
  }

  if (color.startsWith('#')) {
    const hex = color.slice(1)
    const expanded =
      hex.length === 3
        ? hex
            .split('')
            .map((char) => char + char)
            .join('')
        : hex.slice(0, 6)
    const r = parseInt(expanded.slice(0, 2), 16)
    const g = parseInt(expanded.slice(2, 4), 16)
    const b = parseInt(expanded.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${normalizedAlpha})`
  }

  return color
}

function EmptyState() {
  const opacity = useFadeIn(500)

  return (
    <Animated.View style={{ flex: 1, opacity }}>
      <YStack flex={1} justifyContent="center" alignItems="center" padding="$6" gap="$3">
        <Text fontSize={18} fontWeight="700" color="$color" textAlign="center">
          Ready to help with your deal
        </Text>
        <Text fontSize={14} color="$placeholderColor" textAlign="center" lineHeight={22}>
          Tell me about the vehicle you're looking at — year, make, model, and price — and I'll set
          up your insights.
        </Text>
      </YStack>
    </Animated.View>
  )
}

export const ChatMessageList = memo(function ChatMessageList({
  messages,
  vinAssistItems = [],
  isSending,
  isRetrying = false,
  streamingText = '',
  topPadding = 8,
  bottomPadding = 8,
  footer,
  scrollbarOpacity = 1,
  onStartEditUserMessage,
  editingUserMessageId = null,
  editingDraft = '',
  onEditingUserMessageDraftChange,
  onBranchEditSubmitFromBubble,
}: ChatMessageListProps) {
  const justFinalizedId = useJustFinalizedId(messages, streamingText)
  const scrollRef = useRef<ScrollView>(null)
  const messageLayoutY = useRef<Record<string, number>>({})
  const theme = useTheme()
  const renderableMessages = useMemo(() => {
    const seenById = new Map<string, number>()
    return messages.map((message) => {
      const count = seenById.get(message.id) ?? 0
      seenById.set(message.id, count + 1)
      // Defensive keying: backend/optimistic races can temporarily produce duplicate ids.
      // Keep key stable for the first occurrence while disambiguating later duplicates.
      const renderKey = count === 0 ? message.id : `${message.id}::dup-${count}`
      return { message, renderKey }
    })
  }, [messages])

  // Scroll to bottom when messages change
  useEffect(() => {
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true })
    }, 50)
  }, [messages.length])

  useEffect(() => {
    if (!editingUserMessageId) return
    const scrollToEditTarget = () => {
      const targetY = messageLayoutY.current[editingUserMessageId]
      if (targetY === undefined) return
      scrollRef.current?.scrollTo({ y: Math.max(0, targetY - 20), animated: true })
    }
    scrollToEditTarget()
    const followUpScrollTimeoutId = setTimeout(scrollToEditTarget, 80)
    const finalScrollTimeoutId = setTimeout(scrollToEditTarget, 240)
    return () => {
      clearTimeout(followUpScrollTimeoutId)
      clearTimeout(finalScrollTimeoutId)
    }
  }, [editingUserMessageId])

  if (messages.length === 0 && !isSending) {
    return <EmptyState />
  }

  return (
    <ScrollView
      ref={scrollRef}
      showsVerticalScrollIndicator
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: 'flex-end',
        paddingTop: topPadding,
        paddingBottom: bottomPadding,
        // Source message list uses `px-5` so bubbles have 20px breathing room
        // from the chat-card edges (assistant on the left, user on the right).
        paddingHorizontal: 20,
      }}
      style={
        {
          flex: 1,
          scrollbarWidth: 'thin',
          scrollbarColor: `${withAlpha(
            (theme.placeholderColor?.val as string) ?? palette.overlay,
            scrollbarOpacity
          )} transparent`,
        } as any
      }
      onContentSizeChange={() => {
        // Keep scrolled to bottom during streaming
        if (isSending) {
          scrollRef.current?.scrollToEnd({ animated: false })
        }
      }}
    >
      {renderableMessages.map(({ message, renderKey }) => {
        const vinAssistItemsForMessage = vinAssistItems.filter(
          (item) => item.sourceMessageId === message.id
        )
        return (
          <YStack
            key={renderKey}
            onLayout={(layoutEvent) => {
              messageLayoutY.current[message.id] = layoutEvent.nativeEvent.layout.y
            }}
          >
            <ChatBubble
              message={message}
              skipAnimation={message.id === justFinalizedId}
              isEditTarget={message.role === 'user' && editingUserMessageId === message.id}
              editedBodyText={
                message.role === 'user' && editingUserMessageId === message.id
                  ? editingDraft
                  : undefined
              }
              onEditDraftChange={
                message.role === 'user' && editingUserMessageId === message.id
                  ? onEditingUserMessageDraftChange
                  : undefined
              }
              onBranchEditSubmitFromBubble={
                message.role === 'user' && editingUserMessageId === message.id
                  ? onBranchEditSubmitFromBubble
                  : undefined
              }
              onStartEdit={
                onStartEditUserMessage &&
                !isSending &&
                editingUserMessageId !== message.id &&
                message.role === 'user' &&
                message.status !== 'failed' &&
                isServerMessageId(message.id)
                  ? () => onStartEditUserMessage(message.id)
                  : undefined
              }
            />
            {vinAssistItemsForMessage.length > 1 ? (
              <MultiVinAssistCard items={vinAssistItemsForMessage} />
            ) : vinAssistItemsForMessage.length === 1 ? (
              <VinAssistCard item={vinAssistItemsForMessage[0]!} />
            ) : null}
          </YStack>
        )
      })}

      {isSending ? (
        streamingText ? (
          <StreamingBubble text={streamingText} />
        ) : isRetrying ? (
          <RetryingIndicator />
        ) : (
          <TypingIndicator />
        )
      ) : null}

      {footer}
    </ScrollView>
  )
})
