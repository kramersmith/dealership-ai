import { useRef, useEffect, memo, type ReactNode } from 'react'
import { ScrollView, Animated } from 'react-native'
import { YStack, XStack, Text, useTheme } from 'tamagui'
import { palette } from '@/lib/theme/tokens'
import type { Message, VinAssistItem } from '@/lib/types'
import { useFadeIn } from '@/hooks/useAnimatedValue'
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
  const dotColor = theme.placeholderColor?.val as string

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
    animations.forEach((a) => a.start())
    return () => animations.forEach((a) => a.stop())
  }, [dot1, dot2, dot3])

  return (
    <Animated.View style={{ opacity: fadeIn }}>
      <YStack padding="$4" alignItems="flex-start" paddingLeft="$6">
        <XStack
          backgroundColor="$backgroundStrong"
          borderRadius={16}
          paddingHorizontal="$3"
          paddingVertical="$2.5"
          gap="$1.5"
          alignItems="center"
        >
          {[dot1, dot2, dot3].map((dot, i) => (
            <Animated.View
              key={i}
              style={{
                width: 7,
                height: 7,
                borderRadius: 4,
                backgroundColor: dotColor,
                transform: [{ translateY: dot }],
              }}
            />
          ))}
        </XStack>
      </YStack>
    </Animated.View>
  )
}

function RetryingIndicator() {
  const fadeIn = useFadeIn(200)

  return (
    <Animated.View style={{ opacity: fadeIn }}>
      <YStack padding="$4" alignItems="flex-start" paddingLeft="$6">
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
}: ChatMessageListProps) {
  const justFinalizedId = useJustFinalizedId(messages, streamingText)
  const scrollRef = useRef<ScrollView>(null)
  const theme = useTheme()

  // Scroll to bottom when messages change
  useEffect(() => {
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true })
    }, 50)
  }, [messages.length])

  if (messages.length === 0 && !isSending) {
    return <EmptyState />
  }

  return (
    <ScrollView
      ref={scrollRef}
      showsVerticalScrollIndicator
      contentContainerStyle={{ paddingTop: topPadding, paddingBottom: bottomPadding }}
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
      {messages.map((msg) => {
        const assistForMsg = vinAssistItems.filter((item) => item.sourceMessageId === msg.id)
        return (
          <YStack key={msg.id}>
            <ChatBubble message={msg} skipAnimation={msg.id === justFinalizedId} />
            {assistForMsg.length > 1 ? (
              <MultiVinAssistCard items={assistForMsg} />
            ) : assistForMsg.length === 1 ? (
              <VinAssistCard item={assistForMsg[0]!} />
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
