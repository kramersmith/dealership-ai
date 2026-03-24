import { useEffect } from 'react'
import { KeyboardAvoidingView, Platform, TouchableOpacity } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { ThemedSafeArea } from '@/components/shared'
import { Plus } from '@tamagui/lucide-icons'
import { colors } from '@/lib/colors'
import { useChatStore } from '@/stores/chatStore'
import { useChat } from '@/hooks/useChat'
import { DashboardPanel, QuickActions } from '@/components/dashboard'
import { ChatMessageList, ChatInput } from '@/components/chat'
import { LoadingIndicator, HamburgerMenu } from '@/components/shared'

export default function ChatScreen() {
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const createSession = useChatStore((s) => s.createSession)

  useEffect(() => {
    if (!activeSessionId) {
      createSession('buyer_chat', 'New Deal')
    }
  }, [activeSessionId])

  const {
    messages,
    isSending,
    isLoading,
    dealState,
    send,
    handleQuickAction,
    toggleChecklistItem,
  } = useChat(activeSessionId)

  if (isLoading && messages.length === 0) {
    return (
      <ThemedSafeArea>
        <LoadingIndicator message="Loading deal..." />
      </ThemedSafeArea>
    )
  }

  return (
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
            justifyContent="space-between"
            borderBottomWidth={1}
            borderBottomColor="$borderColor"
            backgroundColor="$backgroundStrong"
          >
            <HamburgerMenu />
            <Text fontSize={18} fontWeight="700" color="$color">
              Deal Assistant
            </Text>
            <TouchableOpacity
              onPress={() => createSession('buyer_chat', 'New Deal')}
              activeOpacity={0.6}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <Plus size={22} color={colors.brand} />
            </TouchableOpacity>
          </XStack>

          {/* Dashboard Panel */}
          {dealState && (
            <DashboardPanel
              dealState={dealState}
              onToggleChecklist={toggleChecklistItem}
            />
          )}

          {/* Divider */}
          <YStack height={1} backgroundColor="$borderColor" />

          {/* Chat Messages */}
          <YStack flex={1}>
            <ChatMessageList messages={messages} isSending={isSending} />
          </YStack>

          {/* Quick Actions + Input */}
          <YStack paddingHorizontal="$4">
            <QuickActions onAction={handleQuickAction} />
          </YStack>
          <ChatInput onSend={send} disabled={isSending} />
        </YStack>
      </KeyboardAvoidingView>
    </ThemedSafeArea>
  )
}
