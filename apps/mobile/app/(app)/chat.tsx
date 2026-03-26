import { useRef, useState, useEffect } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Pressable,
  ScrollView,
  Modal,
  View,
  Animated,
  Dimensions,
} from 'react-native'
import { YStack, XStack, Text, useTheme } from 'tamagui'
import { ThemedSafeArea, LoadingIndicator, RoleGuard } from '@/components/shared'
import { Plus, X, ChevronLeft } from '@tamagui/lucide-icons'
import { palette } from '@/lib/theme/tokens'
import {
  APP_NAME,
  DEFAULT_BUYER_CONTEXT,
  FALLBACK_QUICK_ACTIONS,
  QUICK_ACTIONS_STALENESS_THRESHOLD,
  STATIC_ACTIONS_STALENESS_THRESHOLD,
  MOBILE_INSIGHTS_WIDTH_RATIO,
  MOBILE_INSIGHTS_MAX_WIDTH,
} from '@/lib/constants'
import type { BuyerContext, DealState } from '@/lib/types'
import { formatCurrency, vehicleSummary } from '@/lib/utils'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { useRouter } from 'expo-router'
import { useChatStore } from '@/stores/chatStore'
import { useDealStore } from '@/stores/dealStore'
import { useChat } from '@/hooks/useChat'
import { useScreenWidth } from '@/hooks/useScreenWidth'
import { InsightsPanel, QuickActions } from '@/components/insights'
import { ChatMessageList, ChatInput, ContextPicker } from '@/components/chat'

function useMobileInsightsWidth() {
  const [width, setWidth] = useState(
    Math.min(
      Dimensions.get('window').width * MOBILE_INSIGHTS_WIDTH_RATIO,
      MOBILE_INSIGHTS_MAX_WIDTH
    )
  )

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setWidth(Math.min(window.width * MOBILE_INSIGHTS_WIDTH_RATIO, MOBILE_INSIGHTS_MAX_WIDTH))
    })
    return () => subscription.remove()
  }, [])

  return width
}

function getInsightsPreviewDetail(dealState: DealState | null): string {
  if (!dealState) return 'Live buying guidance'
  if (dealState.timerStartedAt) return 'Live dealership timer running'
  if (dealState.numbers.currentOffer != null) {
    return `Current offer ${formatCurrency(dealState.numbers.currentOffer)}`
  }
  if (dealState.numbers.listingPrice != null) {
    return `Listing ${formatCurrency(dealState.numbers.listingPrice)}`
  }
  if (dealState.checklist.length > 0) {
    const done = dealState.checklist.filter((item) => item.done).length
    return `${done}/${dealState.checklist.length} checklist items done`
  }
  const phaseLabel = dealState.phase.replace(/_/g, ' ')
  if (phaseLabel) return `Phase: ${phaseLabel}`
  return 'Live buying guidance'
}

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
  const activeSession = useChatStore((state) =>
    state.sessions.find((s) => s.id === state.activeSessionId)
  )
  const createSession = useChatStore((state) => state.createSession)
  const addGreeting = useChatStore((state) => state.addGreeting)
  const storeQuickActions = useChatStore((state) => state.quickActions)
  const aiResponseCount = useChatStore((state) => state.aiResponseCount)
  const quickActionsUpdatedAtResponse = useChatStore((state) => state.quickActionsUpdatedAtResponse)

  const { isDesktop } = useScreenWidth()
  const router = useRouter()
  const isCreating = useRef(false)
  const theme = useTheme()
  const mobileInsightsWidth = useMobileInsightsWidth()
  const [isInsightsOpen, setIsInsightsOpen] = useState(false)
  const [isInsightsVisible, setIsInsightsVisible] = useState(false)
  const [mobileInsightsPreviewHeight, setMobileInsightsPreviewHeight] = useState(0)
  const insightsSlide = useRef(new Animated.Value(mobileInsightsWidth)).current
  const insightsBackdropOpacity = useRef(new Animated.Value(0)).current

  const {
    messages,
    isSending,
    isLoading,
    streamingText,
    dealState,
    send,
    handleQuickAction,
    toggleChecklistItem,
  } = useChat(activeSessionId)

  const dismissedFlagIds = useDealStore((s) => s.dismissedFlagIds)
  const dismissRedFlag = useDealStore((s) => s.dismissRedFlag)
  const correctNumber = useDealStore((s) => s.correctNumber)
  const correctVehicleField = useDealStore((s) => s.correctVehicleField)

  const showContextPicker = !activeSessionId && !isLoading
  const showMobileInsightsToggle = !isDesktop && !!dealState && !showContextPicker

  useEffect(() => {
    if (!showMobileInsightsToggle && isInsightsOpen) {
      setIsInsightsOpen(false)
    }
  }, [showMobileInsightsToggle, isInsightsOpen])

  useEffect(() => {
    if (isInsightsOpen) {
      setIsInsightsVisible(true)
      Animated.parallel([
        Animated.timing(insightsSlide, {
          toValue: 0,
          duration: 240,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(insightsBackdropOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]).start()
      return
    }

    Animated.parallel([
      Animated.timing(insightsSlide, {
        toValue: mobileInsightsWidth,
        duration: 220,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(insightsBackdropOpacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setIsInsightsVisible(false)
      }
    })
  }, [insightsBackdropOpacity, insightsSlide, isInsightsOpen, mobileInsightsWidth])

  const handleContextSelect = async (context: BuyerContext) => {
    if (isCreating.current) return
    isCreating.current = true

    try {
      const session = await createSession('buyer_chat', undefined, context)
      if (session) {
        addGreeting(GREETING_MESSAGES[context])
      }
    } catch {
      // Error already logged in chatStore
    } finally {
      isCreating.current = false
    }
  }

  const handleDirectSend = async (content: string, imageUri?: string) => {
    if (!activeSessionId) {
      if (isCreating.current) return
      isCreating.current = true

      try {
        const session = await createSession('buyer_chat')
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

  const handleNewSession = () => {
    if (isCreating.current) return
    setIsInsightsOpen(false)
    useChatStore.setState({
      activeSessionId: null,
      messages: [],
      quickActions: [],
      aiResponseCount: 0,
      quickActionsUpdatedAtResponse: 0,
      _sessionJustCreated: false,
    })
  }

  const userMessageCount = messages.filter((message) => message.role === 'user').length
  const hasRealExchange = userMessageCount >= 1
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

  const showQuickActions = !showContextPicker && hasRealExchange && effectiveQuickActions.length > 0
  const mobileChatTopInset = showMobileInsightsToggle ? mobileInsightsPreviewHeight + 8 : 8
  const previewTitle = dealState?.vehicle ? vehicleSummary(dealState.vehicle) : 'Insights'
  const previewDetail = getInsightsPreviewDetail(dealState)

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
      <TouchableOpacity
        onPress={() => router.push('/(app)/chats')}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel="Back to chats"
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <ChevronLeft size={24} color="$color" />
      </TouchableOpacity>
      <Text
        fontSize={18}
        fontWeight="700"
        color="$color"
        flex={1}
        textAlign="center"
        numberOfLines={1}
      >
        {activeSession?.title || APP_NAME}
      </Text>
      <TouchableOpacity
        onPress={handleNewSession}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel="Start new chat"
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <YStack
          width={36}
          height={36}
          borderRadius={12}
          alignItems="center"
          justifyContent="center"
          backgroundColor="$backgroundHover"
          borderWidth={1}
          borderColor="$borderColor"
        >
          <Plus size={18} color="$brand" />
        </YStack>
      </TouchableOpacity>
    </XStack>
  )

  const mobileInsightsPreview =
    showMobileInsightsToggle && dealState ? (
      <Pressable
        onPress={() => setIsInsightsOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Open insights"
        style={{
          marginHorizontal: 12,
          marginTop: 8,
          marginBottom: 6,
          minHeight: 44,
          backgroundColor: 'transparent',
          borderWidth: 0,
          borderColor: 'transparent',
          ...(Platform.OS === 'web'
            ? {
                outlineWidth: 0,
                boxShadow: 'none',
                appearance: 'none',
              }
            : null),
        }}
      >
        <XStack
          alignItems="center"
          gap="$3"
          paddingHorizontal="$3"
          paddingVertical="$2"
          backgroundColor="$backgroundStrong"
          borderRadius="$4"
          borderWidth={1}
          borderColor="$borderColor"
        >
          <YStack flex={1} gap={2}>
            <Text fontSize={13} fontWeight="700" color="$color" numberOfLines={1}>
              {previewTitle}
            </Text>
            <Text fontSize={11} color="$placeholderColor" numberOfLines={1}>
              {previewDetail}
            </Text>
          </YStack>
        </XStack>
      </Pressable>
    ) : null

  const chatColumn = (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      {showContextPicker ? (
        <View style={{ flex: 1, justifyContent: 'center', overflow: 'auto' as any }}>
          <ContextPicker onSelect={handleContextSelect} />
        </View>
      ) : (
        <YStack flex={1} position="relative">
          <ChatMessageList
            messages={messages}
            isSending={isSending}
            streamingText={streamingText}
            topPadding={mobileChatTopInset}
            bottomPadding={12}
            footer={
              showQuickActions ? (
                <YStack paddingHorizontal="$4" paddingTop="$2" paddingBottom="$1">
                  <QuickActions
                    actions={effectiveQuickActions}
                    onAction={handleQuickAction}
                    disabled={isSending}
                  />
                </YStack>
              ) : null
            }
          />
          {mobileInsightsPreview ? (
            <YStack
              position="absolute"
              top={0}
              left={0}
              right={0}
              zIndex={2}
              pointerEvents="box-none"
            >
              <YStack
                onLayout={(event) => {
                  const nextHeight = Math.ceil(event.nativeEvent.layout.height)
                  if (nextHeight !== mobileInsightsPreviewHeight) {
                    setMobileInsightsPreviewHeight(nextHeight)
                  }
                }}
                pointerEvents="box-none"
              >
                {mobileInsightsPreview}
              </YStack>
            </YStack>
          ) : null}
        </YStack>
      )}
      <ChatInput
        onSend={handleDirectSend}
        disabled={isSending}
        placeholder={showContextPicker ? 'Or just tell me what\u2019s going on' : undefined}
      />
    </View>
  )

  if (isDesktop) {
    return (
      <RoleGuard role="buyer">
        <ThemedSafeArea edges={['top']}>
          <YStack flex={1} backgroundColor="$background">
            {header}

            <XStack flex={1}>
              <Animated.View
                style={{
                  width: dealState && !showContextPicker ? 360 : 0,
                  overflow: 'hidden',
                  borderRightWidth: dealState && !showContextPicker ? 1 : 0,
                  borderRightColor: theme.borderColor?.val as string,
                  backgroundColor: theme.backgroundStrong?.val as string,
                  // CSS transition for smooth slide
                  ...(Platform.OS === 'web' ? { transition: 'width 250ms ease-out' } : {}),
                }}
              >
                {dealState ? (
                  <View style={{ width: 360, flex: 1 }}>
                    <ScrollView
                      showsVerticalScrollIndicator
                      style={
                        {
                          flex: 1,
                          scrollbarWidth: 'thin',
                          scrollbarColor: 'rgba(255,255,255,0.15) transparent',
                        } as any
                      }
                    >
                      <InsightsPanel
                        dealState={dealState}
                        dismissedFlagIds={dismissedFlagIds}
                        onToggleChecklist={toggleChecklistItem}
                        onDismissFlag={dismissRedFlag}
                        onCorrectNumber={correctNumber}
                        onCorrectVehicleField={correctVehicleField}
                        mode="sidebar"
                      />
                    </ScrollView>
                  </View>
                ) : null}
              </Animated.View>

              {chatColumn}
            </XStack>
          </YStack>
        </ThemedSafeArea>
      </RoleGuard>
    )
  }

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
            {chatColumn}
          </YStack>
        </KeyboardAvoidingView>

        <Modal
          visible={showMobileInsightsToggle && isInsightsVisible}
          transparent
          animationType="none"
          onRequestClose={() => setIsInsightsOpen(false)}
        >
          <View style={{ flex: 1 }}>
            <Animated.View
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                opacity: insightsBackdropOpacity,
              }}
            >
              <TouchableOpacity
                activeOpacity={1}
                onPress={() => setIsInsightsOpen(false)}
                style={{
                  flex: 1,
                  backgroundColor: palette.overlay,
                }}
              />
            </Animated.View>

            <Animated.View
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                width: mobileInsightsWidth,
                transform: [{ translateX: insightsSlide }],
              }}
            >
              <YStack
                flex={1}
                backgroundColor="$backgroundStrong"
                borderLeftWidth={1}
                borderLeftColor="$borderColor"
                {...(Platform.OS === 'web'
                  ? {
                      style: {
                        boxShadow: `-8px 0 24px ${theme.shadowColor?.val ?? 'rgba(0,0,0,0.3)'}`,
                      },
                    }
                  : {
                      shadowColor: theme.shadowColor?.val ?? 'rgba(0,0,0,0.3)',
                      shadowOffset: { width: -4, height: 0 },
                      shadowOpacity: 1,
                      shadowRadius: 12,
                      elevation: 12,
                    })}
              >
                <ThemedSafeArea edges={['top']}>
                  <YStack flex={1} backgroundColor="$backgroundStrong">
                    <XStack
                      alignItems="center"
                      justifyContent="space-between"
                      paddingHorizontal="$4"
                      paddingVertical="$3"
                      borderBottomWidth={1}
                      borderBottomColor="$borderColor"
                    >
                      <Text fontSize={18} fontWeight="700" color="$color">
                        Insights
                      </Text>
                      <TouchableOpacity
                        onPress={() => setIsInsightsOpen(false)}
                        activeOpacity={0.6}
                        accessibilityRole="button"
                        accessibilityLabel="Close insights"
                        style={{
                          width: 44,
                          height: 44,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <YStack
                          width={36}
                          height={36}
                          borderRadius={12}
                          alignItems="center"
                          justifyContent="center"
                          backgroundColor="$backgroundHover"
                        >
                          <X size={18} color="$color" />
                        </YStack>
                      </TouchableOpacity>
                    </XStack>

                    <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
                      {dealState ? (
                        <InsightsPanel
                          dealState={dealState}
                          dismissedFlagIds={dismissedFlagIds}
                          onToggleChecklist={toggleChecklistItem}
                          onDismissFlag={dismissRedFlag}
                          onCorrectNumber={correctNumber}
                          onCorrectVehicleField={correctVehicleField}
                          mode="mobile"
                        />
                      ) : null}
                    </ScrollView>
                  </YStack>
                </ThemedSafeArea>
              </YStack>
            </Animated.View>
          </View>
        </Modal>
      </ThemedSafeArea>
    </RoleGuard>
  )
}
