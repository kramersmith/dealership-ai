import { useRef, useState, useEffect, useMemo, useCallback } from 'react'
import {
  Alert,
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
import { YStack, XStack, Text, Theme, useTheme } from 'tamagui'
import {
  ConfirmModal,
  ThemedSafeArea,
  LoadingIndicator,
  RoleGuard,
  ScreenHeader,
  HeaderIconButton,
} from '@/components/shared'
import { MessageSquarePlus, X, ChevronLeft } from '@tamagui/lucide-icons'
import { palette } from '@/lib/theme/tokens'
import {
  APP_NAME,
  DEFAULT_BUYER_CONTEXT,
  FALLBACK_QUICK_ACTIONS,
  QUICK_ACTIONS_STALENESS_THRESHOLD,
  STATIC_ACTIONS_STALENESS_THRESHOLD,
  MOBILE_INSIGHTS_WIDTH_RATIO,
  MOBILE_INSIGHTS_MAX_WIDTH,
  MAX_INSIGHTS_PREVIEW_ITEMS,
  WEB_FONT_FAMILY,
} from '@/lib/constants'
import type { BuyerContext, DealState, HealthStatus } from '@/lib/types'
import { formatCurrency, getActiveDeal } from '@/lib/utils'
import { computeBasicHealth, computeSavings } from '@/lib/dealComputations'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { focusDomElementByIdsAfterModalShow } from '@/lib/webModalFocus'
import { getVehicleAwareHeaderTitleInfo } from '@/lib/headerTitles'
import { useRouter } from 'expo-router'
import { useChatStore } from '@/stores/chatStore'
import { useDealStore } from '@/stores/dealStore'
import { useChat } from '@/hooks/useChat'
import { useSlideIn } from '@/hooks/useAnimatedValue'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { useDesktopChatTransition, DESKTOP_INSIGHTS_WIDTH } from '@/hooks/useDesktopChatTransition'
import { useScreenWidth } from '@/hooks/useScreenWidth'
import { STATUS_LABELS, STATUS_THEMES, WEB_SCROLLBAR_GUTTER_PX } from '@/lib/constants'
import { InsightsPanel, QuickActions, CompactPhaseIndicator } from '@/components/insights-panel'
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

/** Build prioritized preview items from deal state. Shows the most important signals first. */
function getPreviewItems(
  dealState: DealState | null,
  dismissedFlagIds: Set<string>
): PreviewItem[] {
  if (!dealState) return [{ type: 'text', label: 'Tap to view insights' }]

  const activeDeal = getActiveDeal(dealState)
  const items: PreviewItem[] = []

  // 0. Multi-deal indicator
  if (dealState.deals.length >= 2) {
    items.push({ type: 'text', label: `${dealState.deals.length} deals` })
  }

  // Merge deal-level + session-level red flags
  const allFlags = [...(activeDeal?.redFlags ?? []), ...dealState.redFlags]

  // 1. Critical red flag — highest priority
  const criticalFlag = allFlags.find(
    (flag) => flag.severity === 'critical' && !dismissedFlagIds.has(flag.id)
  )
  if (criticalFlag) {
    items.push({ type: 'flag', label: criticalFlag.message })
  }

  // 2. Deal health (from active deal)
  const numbers = activeDeal?.numbers
  const healthStatus = activeDeal?.health?.status ?? (numbers ? computeBasicHealth(numbers) : null)
  if (healthStatus) {
    items.push({ type: 'health', status: healthStatus })
  }

  // 3. Current offer or listing price (from active deal)
  if (numbers?.currentOffer != null) {
    items.push({ type: 'text', label: formatCurrency(numbers.currentOffer) })
  } else if (numbers?.listingPrice != null) {
    items.push({ type: 'text', label: `List ${formatCurrency(numbers.listingPrice)}` })
  }

  // 4. Savings (from active deal)
  if (activeDeal) {
    const savings =
      activeDeal.savingsEstimate ??
      computeSavings(activeDeal.firstOffer, activeDeal.numbers.currentOffer)
    if (savings != null && savings > 0) {
      items.push({ type: 'savings', label: `Saved ${formatCurrency(savings)}` })
    }
  }

  // 5. Warning flag count (non-critical)
  const warningCount = allFlags.filter(
    (flag) => flag.severity === 'warning' && !dismissedFlagIds.has(flag.id)
  ).length
  if (warningCount > 0 && !criticalFlag) {
    items.push({ type: 'flagCount', count: warningCount })
  }

  // 6. Timer
  if (dealState.timerStartedAt) {
    items.push({ type: 'text', label: 'Timer running' })
  }

  // Fallback
  if (items.length === 0) {
    items.push({ type: 'text', label: 'Tap to view insights' })
  }

  return items
}

type PreviewItem =
  | { type: 'health'; status: HealthStatus }
  | { type: 'text'; label: string }
  | { type: 'flag'; label: string }
  | { type: 'savings'; label: string }
  | { type: 'flagCount'; count: number }

function getUserVisibleErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback
  const message = error.message.trim()
  if (!message) return fallback
  if (/^(?:API|Chat API) \d+\b/.test(message)) return fallback
  return message
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

const EDIT_BRANCH_CONFIRM_TITLE = 'Edit from here'
const EDIT_BRANCH_CONFIRM_MESSAGE =
  'If there are replies after this message, they will be removed. Deal and vehicle details stored for this chat will be cleared. Your shopping situation (such as researching or at the dealership) is kept.'
const EDIT_BRANCH_CONFIRM_CONTINUE_LABEL = 'Continue'
const EDIT_BRANCH_CONFIRM_CANCEL_DOM_ID = 'edit-branch-confirm-cancel'
const QUEUE_PREVIEW_EXIT_MS = 220
const WEB_QUEUE_PREVIEW_SPACING_PX = 1
const WEB_QUEUE_PREVIEW_CARD_WIDTH_PX = 320
const MAX_QUEUE_PREVIEW_CARDS = 3

function QueuePreviewCard({
  content,
  exiting,
  prefersReducedMotion,
}: {
  content: string
  exiting: boolean
  prefersReducedMotion: boolean
}) {
  const opacity = useRef(new Animated.Value(prefersReducedMotion ? 1 : 0)).current
  const translateY = useRef(new Animated.Value(prefersReducedMotion ? 0 : 8)).current
  const scale = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (prefersReducedMotion) {
      opacity.setValue(exiting ? 0 : 1)
      translateY.setValue(0)
      scale.setValue(1)
      return
    }
    if (exiting) {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: QUEUE_PREVIEW_EXIT_MS,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(translateY, {
          toValue: -8,
          duration: QUEUE_PREVIEW_EXIT_MS,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(scale, {
          toValue: 0.98,
          duration: QUEUE_PREVIEW_EXIT_MS,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]).start()
      return
    }
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 180,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: 180,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]).start()
  }, [exiting, opacity, prefersReducedMotion, scale, translateY])

  return (
    <Animated.View
      style={{
        opacity,
        transform: [{ translateY }, { scale }],
        width: Platform.OS === 'web' ? WEB_QUEUE_PREVIEW_CARD_WIDTH_PX : undefined,
        alignSelf: 'flex-end',
      }}
    >
      <YStack
        maxWidth={Platform.OS === 'web' ? undefined : '78%'}
        width={Platform.OS === 'web' ? '100%' : undefined}
        backgroundColor="$backgroundHover"
        borderWidth={1}
        borderColor="$borderColor"
        borderRadius="$4"
        paddingHorizontal="$3"
        paddingVertical="$2"
      >
        <Text fontSize={11} color="$placeholderColor" lineHeight={16}>
          Queued
        </Text>
        <Text fontSize={13} lineHeight={19} color="$color" numberOfLines={2}>
          {content}
        </Text>
      </YStack>
    </Animated.View>
  )
}

export default function ChatScreen() {
  const activeSessionId = useChatStore((state) => state.activeSessionId)
  const activeSessionTitle = useChatStore(
    (state) => state.sessions.find((session) => session.id === state.activeSessionId)?.title
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
  const [webScrollbarGutterPx, setWebScrollbarGutterPx] = useState(WEB_SCROLLBAR_GUTTER_PX)

  const {
    messages,
    isSending,
    isLoading,
    streamingText,
    isStopRequested,
    isPanelAnalyzing,
    pendingQueueItems,
    canBranchEdit,
    send,
    stopGeneration,
    handleQuickAction,
  } = useChat(activeSessionId)
  const editingUserMessageId = useChatStore((state) => state.editingUserMessageId)
  const startEditUserMessage = useChatStore((state) => state.startEditUserMessage)
  const cancelEditUserMessage = useChatStore((state) => state.cancelEditUserMessage)
  const sendBranchFromEdit = useChatStore((state) => state.sendBranchFromEdit)
  const sendError = useChatStore((state) => state.sendError)
  const clearSendError = useChatStore((state) => state.clearSendError)
  const [editDraft, setEditDraft] = useState('')
  const [editBranchConfirmOpen, setEditBranchConfirmOpen] = useState(false)
  const editBranchConfirmResolveRef = useRef<((confirmed: boolean) => void) | null>(null)
  const vinAssistItems = useChatStore((state) => state.vinAssistItems)
  /** Hide quick-action chips while a message is paused for VIN decode/confirm (avoids overlap with VIN assist UI). */
  const pendingVinIntercept = useChatStore((state) => state._pendingSend != null)
  const isRetrying = useChatStore((state) => state.isRetrying)
  const contextPressure = useChatStore((state) => state.contextPressure)
  const isCompacting = useChatStore((state) => state.isCompacting)
  const suppressContextWarningUntilUsageRefresh = useChatStore(
    (state) => state.suppressContextWarningUntilUsageRefresh
  )
  const prefersReducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    if (Platform.OS !== 'web') return
    const measureScrollbarGutter = () => {
      if (typeof window === 'undefined' || typeof document === 'undefined') return
      const viewportScrollbarGutter = Math.max(
        0,
        window.innerWidth - document.documentElement.clientWidth
      )
      setWebScrollbarGutterPx(viewportScrollbarGutter)
    }
    measureScrollbarGutter()
    window.addEventListener('resize', measureScrollbarGutter)
    return () => window.removeEventListener('resize', measureScrollbarGutter)
  }, [])

  const webQueuePreviewRightInsetPx = useMemo(() => {
    if (Platform.OS !== 'web') return 0
    const measuredGutter =
      Number.isFinite(webScrollbarGutterPx) && webScrollbarGutterPx > 0
        ? webScrollbarGutterPx
        : WEB_SCROLLBAR_GUTTER_PX
    const gutter = Math.max(WEB_SCROLLBAR_GUTTER_PX, measuredGutter)
    return Math.max(0, gutter + WEB_QUEUE_PREVIEW_SPACING_PX)
  }, [webScrollbarGutterPx])

  // Mobile entrance animation — fade + slide up when the chat screen mounts
  const mobileEntrance = useSlideIn(isDesktop ? 0 : 260, 40)

  // Subscribe to dealState only for mobile preview — desktop doesn't need it
  const dealState = useDealStore((state) => state.dealState)

  const dismissedFlagIds = useDealStore((state) => state.dismissedFlagIds)
  const showContextPicker = !activeSessionId && !isLoading

  useEffect(() => {
    if (!editingUserMessageId) {
      setEditDraft('')
      return
    }
    const editingMessage = messages.find((message) => message.id === editingUserMessageId)
    setEditDraft(editingMessage?.content ?? '')
  }, [editingUserMessageId, messages])

  useEffect(() => {
    if (
      Platform.OS !== 'web' ||
      !editingUserMessageId ||
      showContextPicker ||
      editBranchConfirmOpen
    ) {
      return
    }
    const onKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key !== 'Escape' && keyboardEvent.code !== 'Escape') return
      keyboardEvent.preventDefault()
      keyboardEvent.stopPropagation()
      cancelEditUserMessage()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [editingUserMessageId, editBranchConfirmOpen, cancelEditUserMessage, showContextPicker])

  const headerTitleInfo = useMemo(
    () => getVehicleAwareHeaderTitleInfo(activeSessionTitle, dealState, APP_NAME),
    [activeSessionTitle, dealState]
  )
  const headerTitle = showContextPicker ? 'New Chat' : headerTitleInfo.title
  const showMobileInsightsToggle = !isDesktop && !!dealState && !showContextPicker
  const isDesktopChatActive = isDesktop && !showContextPicker

  const navigateBackOrChats = useCallback(() => {
    if (router.canGoBack()) {
      router.back()
      return
    }
    router.replace('/(app)/chats')
  }, [router])

  const desktopTransition = useDesktopChatTransition({
    dealState,
    enabled: isDesktopChatActive,
    onBackComplete: navigateBackOrChats,
    onResetComplete: () => {
      useChatStore.setState({
        activeSessionId: null,
        messages: [],
        streamingText: '',
        vinAssistItems: [],
        quickActions: [],
        aiResponseCount: 0,
        quickActionsUpdatedAtResponse: 0,
        activeTurnId: null,
        isStopRequested: false,
        panelInterruptionNotice: null,
        _sessionJustCreated: false,
        contextPressure: null,
        isCompacting: false,
        suppressContextWarningUntilUsageRefresh: false,
        editingUserMessageId: null,
        activeQueueItemId: null,
        isQueueDispatching: false,
      })
    },
  })

  const handleBack = useCallback(() => {
    if (isDesktopChatActive) {
      desktopTransition.beginBackNavigation()
    } else {
      navigateBackOrChats()
    }
  }, [isDesktopChatActive, desktopTransition, navigateBackOrChats])

  const dismissEditBranchConfirm = useCallback((confirmed: boolean) => {
    const resolve = editBranchConfirmResolveRef.current
    editBranchConfirmResolveRef.current = null
    resolve?.(confirmed)
    setEditBranchConfirmOpen(false)
  }, [])

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
    } catch (error) {
      Alert.alert('Unable to start chat', getUserVisibleErrorMessage(error, 'Please try again.'))
    } finally {
      isCreating.current = false
    }
  }

  const handleVinSubmit = async (vin: string) => {
    if (isCreating.current) return
    isCreating.current = true

    try {
      const session = await createSession('buyer_chat', undefined, 'researching')
      if (session) {
        await useChatStore.getState().submitVinFromPanel(vin)
      }
    } catch (error) {
      Alert.alert(
        'Unable to start VIN lookup',
        getUserVisibleErrorMessage(error, 'Please try again.')
      )
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
      } catch (error) {
        Alert.alert(
          'Unable to send message',
          getUserVisibleErrorMessage(error, 'Please try again.')
        )
      } finally {
        isCreating.current = false
      }
    } else {
      if (editingUserMessageId) {
        let confirmed: boolean
        if (Platform.OS === 'web') {
          confirmed = await new Promise<boolean>((resolve) => {
            editBranchConfirmResolveRef.current = resolve
            setEditBranchConfirmOpen(true)
          })
        } else {
          confirmed = await new Promise<boolean>((resolve) => {
            Alert.alert(EDIT_BRANCH_CONFIRM_TITLE, EDIT_BRANCH_CONFIRM_MESSAGE, [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
              {
                text: EDIT_BRANCH_CONFIRM_CONTINUE_LABEL,
                style: 'default',
                onPress: () => resolve(true),
              },
            ])
          })
        }
        if (!confirmed) return
        await sendBranchFromEdit(content, imageUri)
        return
      }
      await send(content, imageUri)
    }
  }

  const handleNewSession = () => {
    if (isCreating.current) return
    setIsInsightsOpen(false)
    if (isDesktopChatActive) {
      desktopTransition.beginChatReset()
      return
    }
    useChatStore.setState({
      activeSessionId: null,
      messages: [],
      vinAssistItems: [],
      quickActions: [],
      aiResponseCount: 0,
      quickActionsUpdatedAtResponse: 0,
      activeTurnId: null,
      isStopRequested: false,
      panelInterruptionNotice: null,
      _sessionJustCreated: false,
      contextPressure: null,
      isCompacting: false,
      suppressContextWarningUntilUsageRefresh: false,
      editingUserMessageId: null,
      activeQueueItemId: null,
      isQueueDispatching: false,
    })
  }

  const userMessageCount = messages.filter((message) => message.role === 'user').length
  const hasRealExchange = userMessageCount >= 1
  const hasDynamicActions = storeQuickActions.length > 0
  const isStaleDynamic =
    hasDynamicActions &&
    aiResponseCount - quickActionsUpdatedAtResponse >= QUICK_ACTIONS_STALENESS_THRESHOLD
  const isStaleStatic = !hasDynamicActions && aiResponseCount >= STATIC_ACTIONS_STALENESS_THRESHOLD

  const effectiveQuickActions = useMemo(
    () =>
      hasDynamicActions
        ? isStaleDynamic
          ? []
          : storeQuickActions
        : isStaleStatic
          ? []
          : (FALLBACK_QUICK_ACTIONS[dealState?.buyerContext ?? DEFAULT_BUYER_CONTEXT] ?? []),
    [hasDynamicActions, isStaleDynamic, storeQuickActions, isStaleStatic, dealState?.buyerContext]
  )

  const showQuickActions =
    !showContextPicker &&
    hasRealExchange &&
    effectiveQuickActions.length > 0 &&
    !pendingVinIntercept
  const mobileChatTopInset = showMobileInsightsToggle ? mobileInsightsPreviewHeight + 8 : 8
  const previewItems = getPreviewItems(dealState, dismissedFlagIds)
  const activeDealForPreview = dealState ? getActiveDeal(dealState) : null
  const sendErrorText =
    sendError && editingUserMessageId
      ? `${sendError} Edit the highlighted message and send again.`
      : sendError

  const quickActionsFooter = useMemo(
    () =>
      showQuickActions ? (
        <YStack paddingHorizontal="$4" paddingTop="$2" paddingBottom="$1">
          <QuickActions
            actions={effectiveQuickActions}
            onAction={handleQuickAction}
            disabled={false}
          />
        </YStack>
      ) : null,
    [showQuickActions, effectiveQuickActions, handleQuickAction]
  )
  const queuedItems = useMemo(
    () => pendingQueueItems.filter((item) => item.status === 'queued'),
    [pendingQueueItems]
  )
  const queuedPreviewItems = useMemo(
    () => queuedItems.slice(0, MAX_QUEUE_PREVIEW_CARDS),
    [queuedItems]
  )
  const queuedOverflowCount = useMemo(
    () => Math.max(0, queuedItems.length - MAX_QUEUE_PREVIEW_CARDS),
    [queuedItems]
  )
  const [queuedRenderableItems, setQueuedRenderableItems] = useState<
    { id: string; content: string; exiting: boolean }[]
  >([])

  useEffect(() => {
    const nextById = new Set(queuedPreviewItems.map((item) => item.id))
    setQueuedRenderableItems((previous) => {
      const nextItems = queuedPreviewItems.map((item) => ({
        id: item.id,
        content: item.payload.content,
        exiting: false,
      }))
      const exitingItems = previous
        .filter((item) => !nextById.has(item.id) && !item.exiting)
        .map((item) => ({ ...item, exiting: true }))
      const candidate = [...nextItems, ...exitingItems]
      if (candidate.length === previous.length) {
        const same = candidate.every((item, index) => {
          const prior = previous[index]
          return (
            prior &&
            prior.id === item.id &&
            prior.content === item.content &&
            prior.exiting === item.exiting
          )
        })
        if (same) return previous
      }
      return candidate
    })
  }, [queuedPreviewItems])

  useEffect(() => {
    if (prefersReducedMotion) {
      setQueuedRenderableItems((previous) => {
        const hasExiting = previous.some((item) => item.exiting)
        if (!hasExiting) return previous
        return previous.filter((item) => !item.exiting)
      })
      return
    }
    const hasExiting = queuedRenderableItems.some((item) => item.exiting)
    if (!hasExiting) return
    const timeout = setTimeout(() => {
      setQueuedRenderableItems((previous) => previous.filter((item) => !item.exiting))
    }, QUEUE_PREVIEW_EXIT_MS + 20)
    return () => clearTimeout(timeout)
  }, [queuedRenderableItems, prefersReducedMotion])

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
    <ScreenHeader
      leftIcon={<ChevronLeft size={24} color="$color" />}
      onLeftPress={handleBack}
      leftLabel="Back to chats"
      title={headerTitle}
      rightIcon={<MessageSquarePlus size={22} color="$white" />}
      onRightPress={handleNewSession}
      rightLabel="Start new chat"
    />
  )

  const mobileInsightsPreview =
    showMobileInsightsToggle && dealState ? (
      <Pressable
        onPress={() => setIsInsightsOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Open insights"
        style={({ pressed }) => ({
          marginHorizontal: 12,
          marginTop: 8,
          marginBottom: 6,
          minHeight: 44,
          opacity: pressed ? 0.96 : 1,
          transform: [{ scale: pressed ? 0.995 : 1 }],
          backgroundColor: 'transparent',
          borderWidth: 0,
          borderColor: 'transparent',
          ...(Platform.OS === 'web'
            ? {
                outlineWidth: 0,
                boxShadow: 'none',
                appearance: 'none',
                cursor: 'pointer',
              }
            : null),
        })}
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
          <XStack flex={1} alignItems="center" justifyContent="space-evenly">
            {previewItems.slice(0, MAX_INSIGHTS_PREVIEW_ITEMS).map((item, i) => {
              switch (item.type) {
                case 'health': {
                  return (
                    <XStack key={i} alignItems="center" gap="$1.5">
                      <Theme name={STATUS_THEMES[item.status]}>
                        <YStack width={8} height={8} borderRadius={4} backgroundColor="$color" />
                      </Theme>
                      <Text fontSize={12} fontWeight="600" color="$color" numberOfLines={1}>
                        {STATUS_LABELS[item.status]}
                      </Text>
                    </XStack>
                  )
                }
                case 'flag':
                  return (
                    <Text
                      key={i}
                      fontSize={11}
                      fontWeight="600"
                      color="$danger"
                      numberOfLines={1}
                      flex={1}
                    >
                      {item.label}
                    </Text>
                  )
                case 'savings':
                  return (
                    <Text
                      key={i}
                      fontSize={12}
                      fontWeight="600"
                      color="$positive"
                      numberOfLines={1}
                    >
                      {item.label}
                    </Text>
                  )
                case 'flagCount':
                  return (
                    <XStack
                      key={i}
                      backgroundColor="$danger"
                      borderRadius={8}
                      paddingHorizontal={6}
                      paddingVertical={1}
                    >
                      <Text fontSize={10} fontWeight="700" color="$white">
                        {item.count}
                      </Text>
                    </XStack>
                  )
                case 'text':
                  return (
                    <Text key={i} fontSize={12} fontWeight="500" color="$color" numberOfLines={1}>
                      {item.label}
                    </Text>
                  )
              }
            })}
            {activeDealForPreview?.phase && (
              <CompactPhaseIndicator currentPhase={activeDealForPreview.phase} />
            )}
          </XStack>
        </XStack>
      </Pressable>
    ) : null

  const chatColumn = (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      {showContextPicker ? (
        <View style={{ flex: 1, justifyContent: 'center', overflow: 'auto' as any }}>
          <ContextPicker onSelect={handleContextSelect} onVinSubmit={handleVinSubmit} />
        </View>
      ) : (
        <YStack flex={1} position="relative">
          <ChatMessageList
            messages={messages}
            vinAssistItems={vinAssistItems}
            isSending={isSending}
            isRetrying={isRetrying}
            streamingText={streamingText}
            topPadding={mobileChatTopInset}
            bottomPadding={pendingVinIntercept ? 28 : 12}
            footer={quickActionsFooter}
            scrollbarOpacity={isDesktop ? desktopTransition.scrollbarOpacity : 1}
            onStartEditUserMessage={canBranchEdit ? startEditUserMessage : undefined}
            editingUserMessageId={editingUserMessageId}
            editingDraft={editDraft}
            onEditingUserMessageDraftChange={setEditDraft}
            onBranchEditSubmitFromBubble={() => {
              const trimmedEditDraft = editDraft.trim()
              if (!trimmedEditDraft) return
              void handleDirectSend(trimmedEditDraft)
            }}
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
      {isCompacting ? (
        <YStack paddingHorizontal="$3" paddingVertical="$2" backgroundColor="$backgroundHover">
          <Text fontSize={12} lineHeight={18} color="$placeholderColor">
            Summarizing earlier messages so the assistant can keep full context…
          </Text>
        </YStack>
      ) : null}
      {!suppressContextWarningUntilUsageRefresh &&
      contextPressure &&
      (contextPressure.level === 'warn' || contextPressure.level === 'critical') ? (
        <Theme name="warning">
          <YStack
            paddingHorizontal="$3"
            paddingVertical="$2"
            borderTopWidth={1}
            borderTopColor="$borderColor"
            backgroundColor="$background"
          >
            <Text fontSize={12} lineHeight={18} color="$color">
              {contextPressure.level === 'critical'
                ? 'Context usage is very high. The assistant may summarize older turns automatically on your next message.'
                : 'Context usage is getting high. Consider starting a fresh chat for a new vehicle or deal if replies degrade.'}{' '}
              (about {contextPressure.estimatedInputTokens.toLocaleString()} /{' '}
              {contextPressure.inputBudget.toLocaleString()} tokens)
            </Text>
          </YStack>
        </Theme>
      ) : null}
      {sendErrorText ? (
        <Theme name="warning">
          <XStack
            alignItems="center"
            gap="$2"
            paddingHorizontal="$3"
            paddingVertical="$2"
            borderTopWidth={1}
            borderTopColor="$borderColor"
            backgroundColor="$background"
          >
            <Text flex={1} fontSize={12} lineHeight={18} color="$color">
              {sendErrorText}
            </Text>
            <TouchableOpacity
              onPress={clearSendError}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              {...(Platform.OS === 'web'
                ? ({ 'aria-label': 'Dismiss chat error' } as any)
                : { accessibilityLabel: 'Dismiss chat error' })}
            >
              <XStack width={44} height={44} alignItems="center" justifyContent="center">
                <X size={18} color="$color" />
              </XStack>
            </TouchableOpacity>
          </XStack>
        </Theme>
      ) : null}
      <View style={{ position: 'relative' }}>
        {queuedRenderableItems.length > 0 ? (
          <YStack
            position="absolute"
            right={Platform.OS === 'web' ? webQueuePreviewRightInsetPx : '$3'}
            width={Platform.OS === 'web' ? WEB_QUEUE_PREVIEW_CARD_WIDTH_PX : undefined}
            bottom="100%"
            marginBottom="$2.5"
            gap="$1.5"
            alignItems="flex-end"
            pointerEvents="none"
            zIndex={3}
          >
            {queuedRenderableItems.map((item) => (
              <QueuePreviewCard
                key={item.id}
                content={item.content}
                exiting={item.exiting}
                prefersReducedMotion={prefersReducedMotion}
              />
            ))}
            {queuedOverflowCount > 0 ? (
              <Text fontSize={11} color="$placeholderColor">
                +{queuedOverflowCount} more queued
              </Text>
            ) : null}
          </YStack>
        ) : null}
        <ChatInput
          onSend={handleDirectSend}
          disabled={false}
          isGenerating={isSending || isPanelAnalyzing}
          isStopRequested={isStopRequested}
          onStop={() => void stopGeneration()}
          placeholder={
            showContextPicker
              ? 'Or just tell me what\u2019s going on'
              : editingUserMessageId
                ? 'Edit your message\u2026'
                : undefined
          }
          controlledText={editingUserMessageId ? editDraft : null}
          onControlledTextChange={editingUserMessageId ? setEditDraft : undefined}
          editModeBanner={editingUserMessageId ? { onCancel: () => cancelEditUserMessage() } : null}
          editingMessageId={editingUserMessageId}
        />
      </View>
    </View>
  )

  const editBranchConfirmModal = (
    <ConfirmModal
      visible={editBranchConfirmOpen}
      title={EDIT_BRANCH_CONFIRM_TITLE}
      message={EDIT_BRANCH_CONFIRM_MESSAGE}
      confirmLabel={EDIT_BRANCH_CONFIRM_CONTINUE_LABEL}
      confirmVariant="primary"
      webCancelDomId={EDIT_BRANCH_CONFIRM_CANCEL_DOM_ID}
      onConfirm={() => dismissEditBranchConfirm(true)}
      onCancel={() => dismissEditBranchConfirm(false)}
    />
  )

  if (isDesktop) {
    return (
      <RoleGuard role="buyer">
        <ThemedSafeArea edges={['top']}>
          <YStack flex={1} backgroundColor="$background">
            {header}

            <View style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <Animated.View
                style={{
                  flex: 1,
                  marginRight: desktopTransition.chatInset,
                  opacity: desktopTransition.chatOpacity,
                }}
              >
                {chatColumn}
              </Animated.View>

              {/* AI Insights Panel — right sidebar on desktop */}
              {desktopTransition.isInsightsVisible && desktopTransition.insightsDealState ? (
                <Animated.View
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    bottom: 0,
                    width: DESKTOP_INSIGHTS_WIDTH,
                    overflow: 'hidden',
                    borderLeftWidth: 1,
                    borderLeftColor: theme.borderColor?.val as string,
                    backgroundColor: theme.backgroundStrong?.val as string,
                    opacity: desktopTransition.insightsOpacity,
                    transform: [{ translateX: desktopTransition.insightsTranslateX }],
                  }}
                >
                  <View style={{ width: '100%', flex: 1 }}>
                    <ScrollView
                      showsVerticalScrollIndicator
                      style={
                        {
                          flex: 1,
                          scrollbarWidth: 'thin',
                          scrollbarColor: `${theme.placeholderColor?.val ?? palette.overlay} transparent`,
                        } as any
                      }
                      contentContainerStyle={{ flexGrow: 1 }}
                    >
                      <InsightsPanel dealStateOverride={desktopTransition.insightsDealState} />
                    </ScrollView>
                  </View>
                </Animated.View>
              ) : null}
            </View>
          </YStack>
        </ThemedSafeArea>
        {editBranchConfirmModal}
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
            <Animated.View
              style={{
                flex: 1,
                opacity: mobileEntrance.opacity,
                transform: [{ translateY: mobileEntrance.translateY }],
              }}
            >
              {chatColumn}
            </Animated.View>
          </YStack>
        </KeyboardAvoidingView>

        <Modal
          visible={showMobileInsightsToggle && isInsightsVisible}
          transparent
          animationType="none"
          onRequestClose={() => setIsInsightsOpen(false)}
          onShow={() =>
            focusDomElementByIdsAfterModalShow(
              'chat-mobile-insights-close',
              'chat-mobile-insights-focus-root'
            )
          }
        >
          <View style={{ flex: 1, fontFamily: WEB_FONT_FAMILY } as any}>
            {Platform.OS === 'web' ? (
              <View
                {...({
                  id: 'chat-mobile-insights-focus-root',
                  tabIndex: -1,
                } as any)}
                style={{
                  position: 'absolute',
                  width: 1,
                  height: 1,
                  opacity: 0,
                  overflow: 'hidden',
                  pointerEvents: 'none',
                }}
              />
            ) : null}
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
                        boxShadow: `-8px 0 24px ${theme.shadowColor?.val ?? palette.shadowOverlay}`,
                      },
                    }
                  : {
                      shadowColor: theme.shadowColor?.val ?? palette.shadowOverlay,
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
                      <HeaderIconButton
                        webDomId="chat-mobile-insights-close"
                        onPress={() => setIsInsightsOpen(false)}
                        accessibilityLabel="Close insights"
                      >
                        <X size={18} color="$color" />
                      </HeaderIconButton>
                    </XStack>

                    <ScrollView
                      showsVerticalScrollIndicator={false}
                      style={{ flex: 1 }}
                      contentContainerStyle={{ flexGrow: 1 }}
                    >
                      {dealState ? <InsightsPanel /> : null}
                    </ScrollView>
                  </YStack>
                </ThemedSafeArea>
              </YStack>
            </Animated.View>
          </View>
        </Modal>
      </ThemedSafeArea>
      {editBranchConfirmModal}
    </RoleGuard>
  )
}
