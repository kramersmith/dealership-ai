import { useRef, useEffect, type ReactNode } from 'react'
import { FlatList, Animated } from 'react-native'
import { YStack, Text, Spinner } from 'tamagui'
import type { Message } from '@/lib/types'
import { useFadeIn } from '@/hooks/useAnimatedValue'
import { ChatBubble } from './ChatBubble'
import { StreamingBubble } from './StreamingBubble'

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

export function ChatMessageList({
  messages,
  isSending,
  streamingText = '',
  topPadding = 8,
  bottomPadding = 8,
  footer,
}: ChatMessageListProps) {
  const flatListRef = useRef<FlatList>(null)

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true })
      }, 100)
    }
  }, [messages.length])

  if (messages.length === 0 && !isSending) {
    return <EmptyState />
  }

  return (
    <FlatList
      ref={flatListRef}
      data={messages}
      extraData={streamingText}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <ChatBubble message={item} />}
      contentContainerStyle={{ paddingTop: topPadding, paddingBottom: bottomPadding }}
      showsVerticalScrollIndicator={false}
      ListFooterComponent={
        <>
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
        </>
      }
      onContentSizeChange={() => {
        flatListRef.current?.scrollToEnd({ animated: true })
      }}
    />
  )
}
