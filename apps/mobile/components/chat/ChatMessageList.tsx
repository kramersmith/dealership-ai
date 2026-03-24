import { useRef, useEffect } from 'react'
import { FlatList } from 'react-native'
import { YStack, Text, Spinner } from 'tamagui'
import type { Message } from '@/lib/types'
import { colors } from '@/lib/colors'
import { ChatBubble } from './ChatBubble'

interface ChatMessageListProps {
  messages: Message[]
  isSending: boolean
}

export function ChatMessageList({ messages, isSending }: ChatMessageListProps) {
  const flatListRef = useRef<FlatList>(null)

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true })
      }, 100)
    }
  }, [messages.length])

  if (messages.length === 0 && !isSending) {
    return (
      <YStack flex={1} justifyContent="center" alignItems="center" padding="$6" gap="$3">
        <Text fontSize={18} fontWeight="700" color="$color" textAlign="center">
          Ready to help with your deal
        </Text>
        <Text fontSize={14} color="$placeholderColor" textAlign="center" lineHeight={22}>
          Tell me about the vehicle you're looking at — year, make, model, and price — and I'll set up your dashboard.
        </Text>
      </YStack>
    )
  }

  return (
    <FlatList
      ref={flatListRef}
      data={messages}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <ChatBubble message={item} />}
      contentContainerStyle={{ paddingVertical: 8 }}
      showsVerticalScrollIndicator={false}
      ListFooterComponent={
        isSending ? (
          <YStack padding="$4" alignItems="flex-start" paddingLeft="$6">
            <Spinner size="small" color={colors.brand} />
          </YStack>
        ) : null
      }
      onContentSizeChange={() => {
        flatListRef.current?.scrollToEnd({ animated: true })
      }}
    />
  )
}
