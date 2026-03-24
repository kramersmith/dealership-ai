import { useEffect } from 'react'
import { KeyboardAvoidingView, Platform, TouchableOpacity, ScrollView } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { ThemedSafeArea } from '@/components/shared'
import { Plus } from '@tamagui/lucide-icons'
import { colors } from '@/lib/colors'
import { useChatStore } from '@/stores/chatStore'
import { useChat } from '@/hooks/useChat'
import { useScreenWidth } from '@/hooks/useScreenWidth'
import { DashboardPanel, QuickActions } from '@/components/dashboard'
import { ChatMessageList, ChatInput } from '@/components/chat'
import { LoadingIndicator, HamburgerMenu } from '@/components/shared'

export default function ChatScreen() {
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const createSession = useChatStore((s) => s.createSession)
  const { isDesktop } = useScreenWidth()

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

  const header = (
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
  )

  const chatColumn = (
    <YStack flex={1}>
      <YStack flex={1}>
        <ChatMessageList messages={messages} isSending={isSending} />
      </YStack>
      <YStack paddingHorizontal="$4">
        <QuickActions onAction={handleQuickAction} />
      </YStack>
      <ChatInput onSend={send} disabled={isSending} />
    </YStack>
  )

  // Desktop: side-by-side layout
  if (isDesktop) {
    return (
      <ThemedSafeArea edges={['top']}>
        <YStack flex={1} backgroundColor="$background">
          {header}

          <XStack flex={1}>
            {/* Left: Dashboard sidebar */}
            {dealState && (
              <YStack
                width={360}
                borderRightWidth={1}
                borderRightColor="$borderColor"
                backgroundColor="$backgroundStrong"
              >
                <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
                  <DashboardPanel
                    dealState={dealState}
                    onToggleChecklist={toggleChecklistItem}
                    mode="sidebar"
                  />
                </ScrollView>
              </YStack>
            )}

            {/* Right: Chat */}
            {chatColumn}
          </XStack>
        </YStack>
      </ThemedSafeArea>
    )
  }

  // Mobile: stacked layout
  return (
    <ThemedSafeArea edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <YStack flex={1} backgroundColor="$background">
          {header}

          {/* Dashboard Panel (collapsible on mobile) */}
          {dealState && (
            <DashboardPanel
              dealState={dealState}
              onToggleChecklist={toggleChecklistItem}
            />
          )}

          {/* Divider */}
          <YStack height={1} backgroundColor="$borderColor" />

          {/* Chat */}
          {chatColumn}
        </YStack>
      </KeyboardAvoidingView>
    </ThemedSafeArea>
  )
}
