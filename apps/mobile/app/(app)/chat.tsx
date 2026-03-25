import { useRef } from 'react'
import { KeyboardAvoidingView, Platform, TouchableOpacity, ScrollView } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { ThemedSafeArea, LoadingIndicator, HamburgerMenu, RoleGuard } from '@/components/shared'
import { Plus } from '@tamagui/lucide-icons'
import { colors } from '@/lib/colors'
import {
  DEFAULT_BUYER_CONTEXT,
  FALLBACK_QUICK_ACTIONS,
  QUICK_ACTIONS_STALENESS_THRESHOLD,
  STATIC_ACTIONS_STALENESS_THRESHOLD,
} from '@/lib/constants'
import type { BuyerContext } from '@/lib/types'
import { useChatStore } from '@/stores/chatStore'
import { useChat } from '@/hooks/useChat'
import { useScreenWidth } from '@/hooks/useScreenWidth'
import { DashboardPanel, QuickActions } from '@/components/dashboard'
import { ChatMessageList, ChatInput, WelcomePrompts } from '@/components/chat'

const GREETING_MESSAGES: Record<BuyerContext, string> = {
  researching:
    'What car are you looking at? Tell me the year, make, and model ' +
    "and I'll help you understand fair pricing and what to watch for.",
  reviewing_deal:
    'Tell me the numbers \u2014 MSRP, their offer, monthly payment, APR \u2014 ' +
    "or snap a photo of the deal sheet. I'll break down what's fair " +
    'and what to push back on.',
  at_dealership:
    'I\u2019m here to help. What\u2019s happening right now? Tell me what they ' +
    'just said or offered, and I\u2019ll tell you exactly how to respond.',
}

export default function ChatScreen() {
  const activeSessionId = useChatStore((state) => state.activeSessionId)
  const createSession = useChatStore((state) => state.createSession)
  const { isDesktop } = useScreenWidth()
  const isCreating = useRef(false)

  const {
    messages,
    isSending,
    isLoading,
    dealState,
    send,
    handleQuickAction,
    toggleChecklistItem,
  } = useChat(activeSessionId)

  const storeQuickActions = useChatStore((state) => state.quickActions)
  const aiResponseCount = useChatStore((state) => state.aiResponseCount)
  const quickActionsUpdatedAtResponse = useChatStore((state) => state.quickActionsUpdatedAtResponse)

  const addGreeting = useChatStore((state) => state.addGreeting)

  // Create session with a buyer context (from card tap)
  const handleContextSelect = async (context: BuyerContext) => {
    if (isCreating.current) return
    isCreating.current = true

    try {
      const session = await createSession('buyer_chat', 'New Deal', context)
      if (session) {
        addGreeting(GREETING_MESSAGES[context])
      }
    } catch {
      // Error already logged in chatStore
    } finally {
      isCreating.current = false
    }
  }

  // Create session without context (user typed or uploaded directly)
  const handleDirectSend = async (content: string, imageUri?: string) => {
    if (!activeSessionId) {
      if (isCreating.current) return
      isCreating.current = true

      try {
        const session = await createSession('buyer_chat', 'New Deal')
        if (session) {
          await send(content, imageUri)
        }
      } catch {
        // Error already logged in chatStore
      } finally {
        isCreating.current = false
      }
    } else {
      await send(content, imageUri)
    }
  }

  // New session button (+) — resets to welcome state
  const handleNewSession = () => {
    if (isCreating.current) return
    useChatStore.setState({
      activeSessionId: null,
      messages: [],
      quickActions: [],
      aiResponseCount: 0,
      quickActionsUpdatedAtResponse: 0,
      _sessionJustCreated: false,
    })
  }

  const showWelcome = !activeSessionId && !isLoading

  // Compute which quick actions to show
  const userMessageCount = messages.filter((message) => message.role === 'user').length
  const hasRealExchange = userMessageCount >= 1 // user has sent at least one message
  const hasDynamicActions = storeQuickActions.length > 0
  const isStaleDynamic =
    hasDynamicActions &&
    aiResponseCount - quickActionsUpdatedAtResponse >= QUICK_ACTIONS_STALENESS_THRESHOLD
  const isStaleStatic = !hasDynamicActions && aiResponseCount >= STATIC_ACTIONS_STALENESS_THRESHOLD

  const effectiveQuickActions = hasDynamicActions
    ? isStaleDynamic
      ? []
      : storeQuickActions
    : isStaleStatic
      ? []
      : (FALLBACK_QUICK_ACTIONS[dealState?.buyerContext ?? DEFAULT_BUYER_CONTEXT] ?? [])

  const showQuickActions = !showWelcome && hasRealExchange && effectiveQuickActions.length > 0

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
        onPress={handleNewSession}
        activeOpacity={0.6}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <Plus size={22} color={colors.brand} />
      </TouchableOpacity>
    </XStack>
  )

  const chatColumn = (
    <YStack flex={1}>
      {showWelcome ? (
        <YStack flex={1} justifyContent="center">
          <WelcomePrompts onSelect={handleContextSelect} />
        </YStack>
      ) : (
        <YStack flex={1}>
          <ChatMessageList messages={messages} isSending={isSending} />
        </YStack>
      )}
      {showQuickActions && (
        <YStack paddingHorizontal="$4">
          <QuickActions
            actions={effectiveQuickActions}
            onAction={handleQuickAction}
            disabled={isSending}
          />
        </YStack>
      )}
      <ChatInput
        onSend={handleDirectSend}
        disabled={isSending}
        placeholder={showWelcome ? 'Or just tell me what\u2019s going on' : undefined}
      />
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
              {dealState && !showWelcome && (
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
            {dealState && !showWelcome && (
              <DashboardPanel dealState={dealState} onToggleChecklist={toggleChecklistItem} />
            )}

            {/* Divider */}
            {!showWelcome && <YStack height={1} backgroundColor="$borderColor" />}

            {/* Chat */}
            {chatColumn}
          </YStack>
        </KeyboardAvoidingView>
      </ThemedSafeArea>
    </RoleGuard>
  )
}
