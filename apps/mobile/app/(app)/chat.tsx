import { useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, TouchableOpacity, ScrollView } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { ThemedSafeArea, LoadingIndicator, HamburgerMenu, RoleGuard } from '@/components/shared'
import { Plus } from '@tamagui/lucide-icons'
import { colors } from '@/lib/colors'
import { useChatStore } from '@/stores/chatStore'
import { useChat } from '@/hooks/useChat'
import { useScreenWidth } from '@/hooks/useScreenWidth'
import { DashboardPanel, QuickActions } from '@/components/dashboard'
import { ChatMessageList, ChatInput } from '@/components/chat'

export default function ChatScreen() {
  const activeSessionId = useChatStore((state) => state.activeSessionId)
  const createSession = useChatStore((state) => state.createSession)
  const { isDesktop } = useScreenWidth()
  const isCreating = useRef(false)
  const [createFailed, setCreateFailed] = useState(false)

  useEffect(() => {
    if (!activeSessionId && !isCreating.current && !createFailed) {
      isCreating.current = true
      createSession('buyer_chat', 'New Deal')
        .catch(() => {
          setCreateFailed(true)
        })
        .finally(() => {
          isCreating.current = false
        })
    }
  }, [activeSessionId, createFailed])

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
      <RoleGuard role="buyer">
        <ThemedSafeArea>
          <LoadingIndicator message="Loading deal..." />
        </ThemedSafeArea>
      </RoleGuard>
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
        onPress={() => {
          if (isCreating.current) return
          isCreating.current = true
          setCreateFailed(false)
          createSession('buyer_chat', 'New Deal').finally(() => {
            isCreating.current = false
          })
        }}
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
      <RoleGuard role="buyer">
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
      </RoleGuard>
    )
  }

  // Mobile: stacked layout
  return (
    <RoleGuard role="buyer">
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
    </RoleGuard>
  )
}
