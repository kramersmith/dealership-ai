import { useEffect } from 'react'
import { KeyboardAvoidingView, Platform, TouchableOpacity } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { ThemedSafeArea, RoleGuard } from '@/components/shared'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ArrowLeft } from '@tamagui/lucide-icons'
import { useChatStore } from '@/stores/chatStore'
import { ChatMessageList, ChatInput } from '@/components/chat'

export default function SimulationChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { messages, isSending, streamingText, setActiveSession, sendMessage } = useChatStore()

  useEffect(() => {
    if (id) {
      setActiveSession(id)
    }
  }, [id])

  return (
    <RoleGuard role="dealer">
      <ThemedSafeArea edges={['top']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <YStack flex={1} backgroundColor="$background">
            {/* Header */}
            <XStack
              paddingHorizontal="$4"
              paddingVertical="$3"
              alignItems="center"
              gap="$3"
              borderBottomWidth={1}
              borderBottomColor="$borderColor"
              backgroundColor="$backgroundStrong"
            >
              <TouchableOpacity
                onPress={() => router.back()}
                activeOpacity={0.6}
                style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <ArrowLeft size={22} color="$color" />
              </TouchableOpacity>
              <YStack flex={1}>
                <Text fontSize={16} fontWeight="700" color="$color">
                  Training Simulation
                </Text>
                <Text fontSize={12} color="$placeholderColor">
                  You are the salesperson. The AI is the customer.
                </Text>
              </YStack>
            </XStack>

            {/* Chat */}
            <YStack flex={1}>
              <ChatMessageList
                messages={messages}
                isSending={isSending}
                streamingText={streamingText}
              />
            </YStack>

            {/* Input */}
            <ChatInput onSend={(content) => sendMessage(content)} disabled={isSending} />
          </YStack>
        </KeyboardAvoidingView>
      </ThemedSafeArea>
    </RoleGuard>
  )
}
