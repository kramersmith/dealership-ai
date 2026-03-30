import { useRef, useEffect, memo, type ReactNode } from 'react'
import { ScrollView, Animated } from 'react-native'
import { YStack, Text, Spinner, useTheme } from 'tamagui'
import { palette } from '@/lib/theme/tokens'
import type { Message } from '@/lib/types'
import { useFadeIn } from '@/hooks/useAnimatedValue'
import { ChatBubble } from './ChatBubble'
import { StreamingBubble } from './StreamingBubble'

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

interface ChatMessageListProps {
  messages: Message[]
  isSending: boolean
  streamingText?: string
  topPadding?: number
  bottomPadding?: number
  footer?: ReactNode
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
  isSending,
  streamingText = '',
  topPadding = 8,
  bottomPadding = 8,
  footer,
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
          scrollbarColor: `${theme.placeholderColor?.val ?? palette.overlay} transparent`,
        } as any
      }
      onContentSizeChange={() => {
        // Keep scrolled to bottom during streaming
        if (isSending) {
          scrollRef.current?.scrollToEnd({ animated: false })
        }
      }}
    >
      {messages.map((msg) => (
        <ChatBubble key={msg.id} message={msg} skipAnimation={msg.id === justFinalizedId} />
      ))}

      {isSending ? (
        streamingText ? (
          <StreamingBubble text={streamingText} />
        ) : (
          <YStack padding="$4" alignItems="flex-start" paddingLeft="$6">
            <Spinner size="small" color="$brand" />
          </YStack>
        )
      ) : null}

      {footer}
    </ScrollView>
  )
})
