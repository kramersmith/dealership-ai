import { useEffect } from 'react'
import { KeyboardAvoidingView, Platform, View } from 'react-native'
import { YStack } from 'tamagui'
import { ChevronLeft } from '@tamagui/lucide-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { CopilotPageHero, CopilotTopNav, RoleGuard, ThemedSafeArea } from '@/components/shared'
import { useChatStore } from '@/stores/chatStore'
import { ChatMessageList, ChatInput } from '@/components/chat'
import { palette } from '@/lib/theme/tokens'
import { PAGE_MAX_WIDTH, PAGE_PADDING_H, PAGE_PADDING_V } from '@/lib/constants'

export default function SimulationChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const {
    messages,
    isSending,
    isPanelAnalyzing,
    isStopRequested,
    streamingText,
    setActiveSession,
    sendMessage,
    stopGeneration,
  } = useChatStore()

  useEffect(() => {
    if (id) {
      setActiveSession(id)
    }
  }, [id, setActiveSession])

  return (
    <RoleGuard role="dealer">
      <ThemedSafeArea edges={['top']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <YStack flex={1} backgroundColor="$background">
            <CopilotTopNav
              leftIcon={<ChevronLeft size={20} color={palette.slate400} />}
              onLeftPress={() => router.back()}
              leftLabel="Back to scenarios"
              paddingHorizontal={PAGE_PADDING_H}
            />

            <View
              style={{
                width: '100%',
                maxWidth: PAGE_MAX_WIDTH,
                alignSelf: 'center',
                paddingHorizontal: PAGE_PADDING_H,
                paddingTop: PAGE_PADDING_V,
              }}
            >
              <CopilotPageHero
                leading="Run the"
                accent="simulation"
                description="You are the salesperson. The AI is the customer."
                isDesktop={false}
                caption={null}
              />
            </View>

            <YStack flex={1}>
              <ChatMessageList
                messages={messages}
                isSending={isSending}
                streamingText={streamingText}
              />
            </YStack>

            <ChatInput
              onSend={(content) => sendMessage(content)}
              disabled={false}
              isGenerating={isSending || isPanelAnalyzing}
              isStopRequested={isStopRequested}
              onStop={() => void stopGeneration()}
            />
          </YStack>
        </KeyboardAvoidingView>
      </ThemedSafeArea>
    </RoleGuard>
  )
}
