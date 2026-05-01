import { useRef, useState, useEffect, useMemo, useCallback } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Pressable,
  Modal,
  ScrollView,
  View,
  Animated,
  Dimensions,
  Easing,
  StyleSheet,
} from 'react-native'
import { YStack, XStack, Text, Theme } from 'tamagui'
import {
  ConfirmModal,
  HeaderIconButton,
  LoadingIndicator,
  RoleGuard,
  ThemedSafeArea,
} from '@/components/shared'
import { Pause, Sparkles, X } from '@tamagui/lucide-icons'
import { palette } from '@/lib/theme/tokens'
import {
  APP_NAME,
  DEFAULT_BUYER_CONTEXT,
  INSIGHTS_COLLAPSED_PREVIEW_UPDATING,
  MAX_INSIGHTS_PREVIEW_ITEMS,
} from '@/lib/constants'
import {
  getCollapsedPrimaryHeadline,
  getDedupedPanelIconKinds,
  getInsightsPreviewItems,
} from '@/lib/insightsCollapsedPreview'
import { modalWebFontFamilyStyle } from '@/lib/modalWebTypography'
import { DEV_COLLAPSE_DESKTOP_INSIGHTS_EVENT } from '@/lib/dev/mockPanelUpdates'
import {
  CHAT_PAGE_MAX_WIDTH_PX,
  CHAT_SCREEN_LAYOUT,
  getChatBottomPadding,
  getChatPageHorizontalPaddingPx,
  getChatPageVerticalPaddingPx,
  getContextPickerBottomPadding,
  getDesktopChatPageRailStyle,
  getDesktopChatRailStyle,
  getDesktopInsightsWidthPx,
  getWebQueuePreviewRightInsetPx,
} from '@/lib/chatLayout'
import type { BuyerContext, Message, VinAssistItem } from '@/lib/types'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { webScrollbarStyle } from '@/lib/scrollbarStyles'
import { focusDomElementByIdsAfterModalShow } from '@/lib/webModalFocus'
import { useRouter } from 'expo-router'
import { useChatStore } from '@/stores/chatStore'
import { useDealStore } from '@/stores/dealStore'
import { useUserSettingsStore } from '@/stores/userSettingsStore'
import { useChat } from '@/hooks/useChat'
import { useIconEntrance, useSlideIn } from '@/hooks/useAnimatedValue'
import {
  createFinishFlashSequence,
  scheduleFinishFlashHaptic,
  useBreathingPulseOverlay,
  useSignatureEntranceAnimation,
} from '@/hooks/useInsightsAnimations'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { DESKTOP_INSIGHTS_WIDTH } from '@/hooks/useDesktopChatTransition'
import { useDesktopInsightsShell } from '@/hooks/useDesktopInsightsShell'
import { useDesktopPanelPreference } from '@/hooks/useDesktopPanelPreference'
import { useScreenWidth } from '@/hooks/useScreenWidth'
import {
  InsightsPanel,
  InsightPanelPreviewIcons,
  InsightsPreviewItemChip,
  describePanelIconKindsForA11y,
} from '@/components/insights-panel'
import {
  BuyerChatHeader,
  BuyerChatPageHero,
  BuyerChatTopNav,
  ChatComposerOverlay,
  ChatMessageList,
  ChatInput,
  ContextPicker,
  FrostedChatRail,
  QueuePreviewCard,
} from '@/components/chat'

/** Set true when `recap/[sessionId]` is registered in `(app)/_layout.tsx`. */
const DEAL_RECAP_ROUTE_ENABLED = false

function useMobileInsightsWidth() {
  // The insights panel is a full-width takeover sheet on mobile — covers the
  // chat below entirely so the user can scan everything without competing
  // with the chat thread peeking through.
  const [width, setWidth] = useState(Dimensions.get('window').width)

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setWidth(window.width)
    })
    return () => subscription.remove()
  }, [])

  return width
}

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

/** Shared reset payload for clearing the active chat session state in chatStore. */
const CHAT_SESSION_RESET_STATE = {
  activeSessionId: null,
  messages: [] as Message[],
  streamingText: '',
  vinAssistItems: [] as VinAssistItem[],
  aiResponseCount: 0,
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
}

const EDIT_BRANCH_CONFIRM_TITLE = 'Edit from here'
const EDIT_BRANCH_CONFIRM_MESSAGE =
  'If there are replies after this message, they will be removed. Deal and vehicle details stored for this chat will be cleared. Your shopping situation (such as researching or at the dealership) is kept.'
const EDIT_BRANCH_CONFIRM_CONTINUE_LABEL = 'Continue'
const EDIT_BRANCH_CONFIRM_CANCEL_DOM_ID = 'edit-branch-confirm-cancel'
const MAX_QUEUE_PREVIEW_CARDS = 3
const QUEUE_PREVIEW_EXIT_MS = 220

export default function ChatScreen() {
  const activeSessionId = useChatStore((state) => state.activeSessionId)
  const activeSession = useChatStore((state) => {
    const id = state.activeSessionId
    if (!id) return null
    return state.sessions.find((session) => session.id === id) ?? null
  })
  const activeSessionTitle = activeSession?.title
  const createSession = useChatStore((state) => state.createSession)
  const addGreeting = useChatStore((state) => state.addGreeting)

  const { width: windowWidth, isDesktop } = useScreenWidth()

  const router = useRouter()
  const isCreating = useRef(false)
  const mobileInsightsWidth = useMobileInsightsWidth()
  const [isInsightsOpen, setIsInsightsOpen] = useState(false)

  const [isInsightsVisible, setIsInsightsVisible] = useState(false)
  const [desktopComposerTrayHeight, setDesktopComposerTrayHeight] = useState(0)
  const insightsSlide = useRef(new Animated.Value(mobileInsightsWidth)).current
  const insightsBackdropOpacity = useRef(new Animated.Value(0)).current

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
  /** True while a message is paused for VIN decode/confirm (avoids overlap with VIN assist UI). */
  const pendingVinIntercept = useChatStore((state) => state._pendingSend != null)
  const isRetrying = useChatStore((state) => state.isRetrying)
  const contextPressure = useChatStore((state) => state.contextPressure)
  const isCompacting = useChatStore((state) => state.isCompacting)
  const suppressContextWarningUntilUsageRefresh = useChatStore(
    (state) => state.suppressContextWarningUntilUsageRefresh
  )
  const prefersReducedMotion = usePrefersReducedMotion()
  const insightsUpdateMode = useUserSettingsStore((state) => state.insightsUpdateMode)
  const { desktopInsightsCollapsed, setDesktopInsightsCollapsed } = useDesktopPanelPreference()

  useEffect(() => {
    if (!__DEV__ || Platform.OS !== 'web' || typeof window === 'undefined') {
      return
    }
    const onDevCollapseDesktopInsights = () => {
      setDesktopInsightsCollapsed(true)
    }
    window.addEventListener(DEV_COLLAPSE_DESKTOP_INSIGHTS_EVENT, onDevCollapseDesktopInsights)
    return () => {
      window.removeEventListener(DEV_COLLAPSE_DESKTOP_INSIGHTS_EVENT, onDevCollapseDesktopInsights)
    }
  }, [setDesktopInsightsCollapsed])

  useEffect(() => {
    if (!__DEV__) {
      return
    }
    // Side effect: registers `mockPanel`, `clearPanel`, `reviewDesktopDockAnimations` on globalThis.
    require('@/lib/dev/mockPanelUpdates')
  }, [])

  const webQueuePreviewRightInsetPx = getWebQueuePreviewRightInsetPx(Platform.OS)

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

  // Click-away: when editing, any pointerdown outside the editing bubble or the
  // composer area exits edit mode.
  useEffect(() => {
    if (
      Platform.OS !== 'web' ||
      !editingUserMessageId ||
      showContextPicker ||
      editBranchConfirmOpen ||
      typeof document === 'undefined'
    ) {
      return
    }
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (!target || typeof target.closest !== 'function') return
      // Inside the editing bubble or the composer area → leave edit mode alone.
      if (target.closest('#chat-edit-target, #chat-composer-area')) return
      cancelEditUserMessage()
    }
    document.addEventListener('mousedown', onPointerDown, true)
    return () => document.removeEventListener('mousedown', onPointerDown, true)
  }, [editingUserMessageId, editBranchConfirmOpen, cancelEditUserMessage, showContextPicker])

  const showMobileInsightsToggle = !isDesktop && !!dealState && !showContextPicker
  const isDesktopChatActive = isDesktop && !showContextPicker
  const buyerContextForPreview = dealState?.buyerContext ?? DEFAULT_BUYER_CONTEXT

  const pageShellPaddingH = getChatPageHorizontalPaddingPx(windowWidth)
  const pageShellPaddingV = getChatPageVerticalPaddingPx(windowWidth)
  const desktopChatRailStyle = isDesktop
    ? showContextPicker
      ? getDesktopChatRailStyle()
      : getDesktopChatPageRailStyle()
    : undefined
  // When the composer sits inside the FrostedChatRail (active session), the rail's
  // own rounded edges define the composer's bounds. Its own band padding (16) handles
  // the inset symmetrically. Only the context-picker mode uses page-shell padding.
  const desktopComposerLeftPx = showContextPicker
    ? CHAT_SCREEN_LAYOUT.desktopChatRailLeftGutterPx
    : 0

  const panelPreviewIconKinds = useMemo(
    () => getDedupedPanelIconKinds(dealState?.aiPanelCards),
    [dealState?.aiPanelCards]
  )

  const collapsedPrimaryHeadline = useMemo(
    () => getCollapsedPrimaryHeadline(dealState, dismissedFlagIds, buyerContextForPreview),
    [dealState, dismissedFlagIds, buyerContextForPreview]
  )

  const collapsedInsightsAccessibilityLabel = useMemo(() => {
    const pausedPrefix =
      insightsUpdateMode === 'paused' && !isPanelAnalyzing ? 'Insights updates paused. ' : ''
    const updating = isPanelAnalyzing ? 'Insights panel is updating. ' : ''
    const iconPart =
      panelPreviewIconKinds.length > 0
        ? `. Includes ${describePanelIconKindsForA11y(panelPreviewIconKinds)}`
        : ''
    return `${pausedPrefix}Open insights panel. ${updating}${collapsedPrimaryHeadline}${iconPart}`
  }, [collapsedPrimaryHeadline, insightsUpdateMode, isPanelAnalyzing, panelPreviewIconKinds])

  const handleDesktopCollapsePress = useCallback(() => {
    setDesktopInsightsCollapsed(true)
  }, [setDesktopInsightsCollapsed])
  const handleDesktopExpandPress = useCallback(() => {
    setDesktopInsightsCollapsed(false)
  }, [setDesktopInsightsCollapsed])
  const handleDesktopComposerTrayHeightChange = useCallback((nextHeight: number) => {
    setDesktopComposerTrayHeight((previousHeight) =>
      previousHeight === nextHeight ? previousHeight : nextHeight
    )
  }, [])

  const navigateBackOrChats = useCallback(() => {
    if (router.canGoBack()) {
      router.back()
      return
    }
    router.replace('/(app)/chats')
  }, [router])

  const resetDesktopChatShell = useCallback(() => {
    useChatStore.setState(CHAT_SESSION_RESET_STATE)
  }, [])

  const desktopInsightsWidth = useMemo(() => getDesktopInsightsWidthPx(windowWidth), [windowWidth])
  const desktopShell = useDesktopInsightsShell({
    dealState,
    enabled: isDesktopChatActive,
    desktopInsightsCollapsed,
    isPanelAnalyzing,
    prefersReducedMotion,
    onCollapseChange: setDesktopInsightsCollapsed,
    onBackComplete: navigateBackOrChats,
    onResetComplete: resetDesktopChatShell,
    insightsWidth: desktopInsightsWidth,
  })
  const { transition: desktopTransition } = desktopShell
  const desktopPanelCollapseEntrance = useIconEntrance(desktopShell.shellState === 'expanded')

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
    useChatStore.setState(CHAT_SESSION_RESET_STATE)
  }

  const handleRecapPress = useCallback(() => {
    if (!DEAL_RECAP_ROUTE_ENABLED || !activeSessionId) return
    // Cast: the recap route is registered conditionally; expo-router's
    // typed `Href` only knows about routes present at build time. Reachable
    // only when `DEAL_RECAP_ROUTE_ENABLED` is flipped on.
    router.push(`/(app)/recap/${activeSessionId}` as any)
  }, [activeSessionId, router])

  // The mobile insights preview strip is gone; the chat just has a small,
  // fixed top inset above the first message.
  const mobileChatTopInset = 8

  // Source composer is a flat band integrated at the bottom of the chat card —
  // its own border-top + bg-slate-950/40 carries the visual chrome, no outer dock.
  const composerTrayStyle = {
    marginHorizontal: 0,
    marginBottom: 0,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  } as any
  const sendErrorText =
    sendError && editingUserMessageId
      ? `${sendError} Edit the highlighted message and send again.`
      : sendError
  const chatBottomPadding = getChatBottomPadding({
    isDesktop,
    desktopComposerTrayHeight,
    pendingVinIntercept,
  })
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

  // Insights toggle handler — desktop expands the side panel, mobile opens
  // the slide-in modal. Declared above the chat header so the header's
  // tap-target wrapper can call it directly.
  const handleInsightsTogglePress = useCallback(() => {
    if (isDesktop) {
      handleDesktopExpandPress()
    } else {
      setIsInsightsOpen(true)
    }
  }, [handleDesktopExpandPress, isDesktop])

  // Inline insights preview — replaces the old phase progress bar in the chat
  // header. Renders the same context as the panel's collapsed strip
  // (analyzing / paused / preview chips + panel kind icons) so the user has
  // deal context at a glance without the panel open.
  const headerInsightsPreviewItems = useMemo(
    () =>
      dealState ? getInsightsPreviewItems(dealState, dismissedFlagIds, buyerContextForPreview) : [],
    [dealState, dismissedFlagIds, buyerContextForPreview]
  )

  if (isLoading && messages.length === 0) {
    return (
      <RoleGuard role="buyer">
        <Theme name="dark_copilot">
          <ThemedSafeArea>
            <YStack flex={1} backgroundColor="$background">
              <LoadingIndicator message="Loading deal..." />
            </YStack>
          </ThemedSafeArea>
        </Theme>
      </RoleGuard>
    )
  }

  const compactingNotice = isCompacting ? (
    <YStack paddingHorizontal="$3" paddingVertical="$2" backgroundColor="$backgroundHover">
      <Text fontSize={12} lineHeight={18} color="$placeholderColor">
        Summarizing earlier messages so the assistant can keep full context…
      </Text>
    </YStack>
  ) : null

  const contextWarningNotice =
    !suppressContextWarningUntilUsageRefresh &&
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
    ) : null

  const sendErrorNotice = sendErrorText ? (
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
  ) : null

  const composerControl = (
    <ChatInput
      onSend={handleDirectSend}
      disabled={false}
      isGenerating={isSending}
      isStopRequested={isStopRequested}
      onStop={() => void stopGeneration()}
      placeholder={
        showContextPicker
          ? 'Or just tell me what\u2019s going on'
          : editingUserMessageId
            ? 'Edit your message\u2026'
            : isDesktop
              ? 'Ask your copilot\u2026 (e.g., \u2018Is $86,900 a good OTD price?\u2019)'
              : 'Ask your copilot\u2026'
      }
      controlledText={editingUserMessageId ? editDraft : null}
      onControlledTextChange={editingUserMessageId ? setEditDraft : undefined}
      editModeBanner={editingUserMessageId ? { onCancel: () => cancelEditUserMessage() } : null}
      editingMessageId={editingUserMessageId}
      surfaceVariant="floating"
    />
  )

  const queuePreview =
    queuedRenderableItems.length > 0 ? (
      <YStack
        position="absolute"
        right={
          Platform.OS === 'web'
            ? webQueuePreviewRightInsetPx +
              (isDesktop ? CHAT_SCREEN_LAYOUT.desktopComposerTrayInsetPx : 0)
            : '$3'
        }
        width={Platform.OS === 'web' ? CHAT_SCREEN_LAYOUT.webQueuePreviewCardWidthPx : undefined}
        bottom="100%"
        marginBottom="$2.5"
        gap="$1.5"
        alignItems="flex-end"
        zIndex={3}
        style={{ pointerEvents: 'none' } as any}
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
    ) : null
  const composerOverlayNotices = (
    <>
      {compactingNotice}
      {contextWarningNotice}
      {sendErrorNotice}
    </>
  )

  const messagesPane = (
    <YStack flex={1} position="relative" minHeight={0}>
      <ChatMessageList
        messages={messages}
        vinAssistItems={vinAssistItems}
        isSending={isSending}
        isRetrying={isRetrying}
        streamingText={streamingText}
        topPadding={mobileChatTopInset}
        bottomPadding={chatBottomPadding}
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
    </YStack>
  )

  const chatComposerOverlay = (
    <ChatComposerOverlay
      isDesktop={isDesktop}
      composerTrayStyle={composerTrayStyle}
      notices={composerOverlayNotices}
      queuePreview={queuePreview}
      composer={composerControl}
      onComposerHeightChange={handleDesktopComposerTrayHeightChange}
    />
  )

  const chatColumn = (
    <View style={[{ flex: 1, overflow: 'hidden', minHeight: 0 }, desktopChatRailStyle]}>
      {showContextPicker ? (
        <ScrollView
          style={{ flex: 1, ...webScrollbarStyle } as any}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            // Trailing inset lives in the scroll content (not the picker's
            // YStack) so it actually extends the scrollable area below the
            // last card before the composer. Padding inside a flex:1 YStack
            // collapses when content overflows.
            paddingBottom: 32,
          }}
          showsVerticalScrollIndicator
        >
          <ContextPicker onSelect={handleContextSelect} onVinSubmit={handleVinSubmit} />
        </ScrollView>
      ) : (
        <View style={{ flex: 1, minHeight: 0 }}>{messagesPane}</View>
      )}
      {chatComposerOverlay}
    </View>
  )

  const isInsightsPanelOpen = isDesktop ? desktopShell.shellState === 'expanded' : isInsightsOpen

  // Build the right-side preview content. The chat header on mobile is the
  // tap-target for opening the insights panel; the discoverable Sparkles
  // affordance for that lives in the header's `leftSlot`
  // (rendered before the title, on the left).
  const headerInsightsPreview = (() => {
    if (!dealState) return null
    if (isPanelAnalyzing) {
      return (
        <Text fontSize={11} fontWeight="700" color="$color" letterSpacing={0.4}>
          {INSIGHTS_COLLAPSED_PREVIEW_UPDATING}
        </Text>
      )
    }
    if (insightsUpdateMode === 'paused') {
      // Mobile: a single explanatory line takes the row (the title is hidden,
      // and the brief "PAUSED" tag would be redundant with the leading icon
      // mute). Desktop keeps the compact tag since it still has the title.
      if (!isDesktop) {
        return (
          <Text fontSize={13} color={palette.slate400} lineHeight={18} flexShrink={1}>
            Insights are paused. Refresh manually.
          </Text>
        )
      }
      return (
        <XStack alignItems="center" gap={6} flexShrink={0}>
          <Pause size={12} color="#fbbf24" />
          <Text
            fontSize={11}
            fontWeight="600"
            color="#fbbf24"
            letterSpacing={0.6}
            textTransform="uppercase"
          >
            Paused
          </Text>
        </XStack>
      )
    }
    return (
      <XStack alignItems="center" gap={10} flexShrink={0} flexWrap="wrap">
        {headerInsightsPreviewItems.slice(0, MAX_INSIGHTS_PREVIEW_ITEMS).map((item, index) => (
          <InsightsPreviewItemChip key={`${item.type}:${index}`} item={item} />
        ))}
        {panelPreviewIconKinds.length > 0 ? (
          <InsightPanelPreviewIcons kinds={panelPreviewIconKinds} />
        ) : null}
      </XStack>
    )
  })()

  // Mobile-only Sparkles icon on the left of the header — visual affordance
  // for "tap to open insights". Desktop puts the labeled pill in the navbar
  // instead, so it's omitted there. Muted color when paused (since the
  // panel isn't actively updating, the emerald accent reads as misleading).
  const headerLeadingIcon =
    !isDesktop && !!dealState ? (
      <Sparkles
        size={16}
        color={insightsUpdateMode === 'paused' ? palette.slate500 : palette.copilotEmerald}
      />
    ) : null

  // Hide the title whenever the right-side content can stand on its own:
  //  - Live / analyzing on any viewport (preview chips carry the context).
  //  - Paused on mobile (the "Insights are paused. Refresh manually." line
  //    needs the row width to read cleanly).
  // Paused on desktop keeps the title since the right slot is just a brief
  // "PAUSED" tag and the title remains a useful anchor.
  const hideHeaderTitle = !!dealState && (insightsUpdateMode !== 'paused' || !isDesktop)

  // On mobile the entire chat header is the open-insights surface; on desktop
  // the labeled pill in the top nav handles it instead, so the header stays
  // non-interactive there.
  const headerWrapsAsButton = !isDesktop && !!dealState && !isInsightsPanelOpen

  const buyerChatHeaderEl = (
    <BuyerChatHeader
      embedded
      sessionTitle={activeSessionTitle}
      previewLine={null}
      isDesktop={isDesktop}
      leftSlot={headerLeadingIcon}
      rightSlot={headerInsightsPreview}
      hideTitle={hideHeaderTitle}
    />
  )

  const sessionFrostedChatBody = (
    <FrostedChatRail style={{ flex: 1, minHeight: 0 }} edgeToEdge={!isDesktop}>
      {headerWrapsAsButton ? (
        <Pressable
          onPress={handleInsightsTogglePress}
          accessibilityRole="button"
          accessibilityLabel="Open insights panel"
          style={({ pressed }) => ({
            opacity: pressed ? 0.85 : 1,
            ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null),
          })}
        >
          {buyerChatHeaderEl}
        </Pressable>
      ) : (
        buyerChatHeaderEl
      )}
      <View style={{ flex: 1, minHeight: 0 }}>{messagesPane}</View>
      {chatComposerOverlay}
    </FrostedChatRail>
  )

  const sessionChatRail = (
    <View
      style={[
        { flex: 1, overflow: 'hidden', position: 'relative', minHeight: 0 },
        desktopChatRailStyle,
      ]}
    >
      {sessionFrostedChatBody}
    </View>
  )

  // Desktop keeps the labeled "Insights" pill in the top nav. Mobile drops
  // the navbar pill entirely — the chat header itself becomes the
  // tap-to-open-insights surface (with a small Sparkles icon as the
  // affordance).
  const showInsightsToggle = !!dealState && !showContextPicker && isDesktop

  const sessionTopNav = (
    <View
      style={{
        width: '100%',
        borderBottomWidth: 1,
        borderBottomColor: palette.ghostBgHover,
        backgroundColor: palette.copilotBackground,
      }}
    >
      <View
        style={{
          width: '100%',
          // Constant horizontal inset matching the chats list / settings /
          // simulations top navs so the back + new-chat icons sit at the same
          // x-position regardless of screen width.
          paddingHorizontal: 24,
        }}
      >
        <BuyerChatTopNav
          onBack={handleBack}
          onNewChat={handleNewSession}
          recapHrefAvailable={DEAL_RECAP_ROUTE_ENABLED && !!activeSessionId}
          onRecapPress={handleRecapPress}
          isDesktop={isDesktop}
          onInsightsTogglePress={showInsightsToggle ? handleInsightsTogglePress : undefined}
          isInsightsOpen={isInsightsPanelOpen}
          isInsightsAnalyzing={isPanelAnalyzing}
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
    // The dock launcher renders inside the chat header (next to the phase
    // progress bar) via `headerDockLauncher` — see `sessionFrostedChatBody`.
    const desktopSessionChrome = (
      <>
        <BuyerChatPageHero dealState={dealState} buyerContext={buyerContextForPreview} isDesktop />
      </>
    )

    const desktopChatDockAndPanel = (
      <>
        {desktopTransition.isInsightsVisible && desktopTransition.insightsDealState ? (
          <Animated.View
            style={{
              width: desktopInsightsWidth,
              flexShrink: 0,
              minHeight: 0,
              opacity: desktopTransition.insightsOpacity,
              transform: [{ translateX: desktopTransition.insightsTranslateX }],
            }}
          >
            <View style={{ width: '100%', flex: 1 }}>
              <View style={{ flex: 1, overflow: 'visible' }}>
                <YStack
                  flex={1}
                  backgroundColor="rgba(2, 6, 23, 0.40)"
                  borderWidth={1}
                  borderColor={palette.ghostBorder}
                  borderRadius={CHAT_SCREEN_LAYOUT.desktopInsightsSheetRadiusPx}
                  overflow="hidden"
                  {...(Platform.OS === 'web'
                    ? {
                        style: {
                          backdropFilter: 'blur(20px) saturate(1.15)',
                          WebkitBackdropFilter: 'blur(20px) saturate(1.15)',
                        },
                      }
                    : {})}
                >
                  <InsightsPanel
                    dealStateOverride={desktopTransition.insightsDealState}
                    headerAccessory={
                      <HeaderIconButton
                        onPress={handleDesktopCollapsePress}
                        accessibilityLabel="Collapse insights panel"
                      >
                        <Animated.View
                          style={{
                            opacity: desktopPanelCollapseEntrance.opacity,
                            transform: [{ rotate: desktopPanelCollapseEntrance.rotate }],
                          }}
                        >
                          <X size={16} color={palette.slate300} />
                        </Animated.View>
                      </HeaderIconButton>
                    }
                  />
                </YStack>
              </View>
            </View>
          </Animated.View>
        ) : null}
      </>
    )

    return (
      <RoleGuard role="buyer">
        <Theme name="dark_copilot">
          <ThemedSafeArea edges={['top']}>
            <YStack flex={1} backgroundColor="$background">
              {sessionTopNav}
              <View
                style={{
                  flex: 1,
                  width: '100%',
                  maxWidth: CHAT_PAGE_MAX_WIDTH_PX,
                  alignSelf: 'center',
                  minHeight: 0,
                }}
              >
                <View
                  style={{
                    flex: 1,
                    minHeight: 0,
                    paddingHorizontal: pageShellPaddingH,
                    paddingTop: pageShellPaddingV,
                    paddingBottom: pageShellPaddingV,
                  }}
                >
                  {showContextPicker ? (
                    <View
                      style={{ flex: 1, position: 'relative', overflow: 'hidden', minHeight: 0 }}
                    >
                      <View style={{ flex: 1, minHeight: 0 }}>{chatColumn}</View>
                    </View>
                  ) : (
                    <>
                      {desktopSessionChrome}
                      <View
                        style={{
                          flex: 1,
                          flexDirection: 'row',
                          gap: CHAT_SCREEN_LAYOUT.desktopInsightsSheetGapPx,
                          minHeight: 0,
                          position: 'relative',
                        }}
                      >
                        <Animated.View
                          style={{
                            flex: 1,
                            minWidth: 0,
                            minHeight: 0,
                            opacity: desktopTransition.chatOpacity,
                          }}
                        >
                          {sessionChatRail}
                        </Animated.View>
                        {desktopChatDockAndPanel}
                      </View>
                    </>
                  )}
                </View>
              </View>
            </YStack>
          </ThemedSafeArea>
          {editBranchConfirmModal}
        </Theme>
      </RoleGuard>
    )
  }

  return (
    <RoleGuard role="buyer">
      <Theme name="dark_copilot">
        <ThemedSafeArea edges={['top']}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={0}
          >
            <YStack flex={1} backgroundColor="$background">
              {sessionTopNav}
              <View
                style={{
                  flex: 1,
                  width: '100%',
                  maxWidth: CHAT_PAGE_MAX_WIDTH_PX,
                  alignSelf: 'center',
                  minHeight: 0,
                }}
              >
                <View
                  style={{
                    flex: 1,
                    minHeight: 0,
                    paddingHorizontal: pageShellPaddingH,
                    paddingTop: pageShellPaddingV,
                    paddingBottom: pageShellPaddingV,
                  }}
                >
                  {showContextPicker ? (
                    <Animated.View
                      style={{
                        flex: 1,
                        minHeight: 0,
                        opacity: mobileEntrance.opacity,
                        transform: [{ translateY: mobileEntrance.translateY }],
                      }}
                    >
                      {chatColumn}
                    </Animated.View>
                  ) : (
                    // Mobile active session: skip the page hero ("Let's find
                    // the right car.") so the chat rail (with its session
                    // title + phase progress strip) acts as the persistent
                    // context header. Linear / Slack / Notion all use this
                    // single-strip pattern on mobile to maximize chat
                    // vertical space.
                    <Animated.View
                      style={{
                        flex: 1,
                        minHeight: 0,
                        opacity: mobileEntrance.opacity,
                        transform: [{ translateY: mobileEntrance.translateY }],
                      }}
                    >
                      {sessionChatRail}
                    </Animated.View>
                  )}
                </View>
              </View>
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
            <View style={{ flex: 1, ...modalWebFontFamilyStyle() } as any}>
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
                  top: CHAT_SCREEN_LAYOUT.mobileInsightsSheetInsetPx,
                  right: 0,
                  bottom: CHAT_SCREEN_LAYOUT.mobileInsightsSheetInsetPx,
                  width: mobileInsightsWidth,
                  transform: [{ translateX: insightsSlide }],
                }}
              >
                <YStack
                  flex={1}
                  backgroundColor="rgba(15, 23, 42, 0.92)"
                  overflow="hidden"
                  {...(Platform.OS === 'web'
                    ? {
                        style: {
                          backdropFilter: 'blur(20px) saturate(1.15)',
                          WebkitBackdropFilter: 'blur(20px) saturate(1.15)',
                        },
                      }
                    : {})}
                >
                  <ThemedSafeArea edges={['top', 'bottom']}>
                    {dealState ? (
                      <InsightsPanel
                        headerAccessory={
                          <HeaderIconButton
                            onPress={() => setIsInsightsOpen(false)}
                            accessibilityLabel="Close insights"
                            webDomId="chat-mobile-insights-close"
                          >
                            <X size={16} color={palette.slate300} />
                          </HeaderIconButton>
                        }
                      />
                    ) : null}
                  </ThemedSafeArea>
                </YStack>
              </Animated.View>
            </View>
          </Modal>
        </ThemedSafeArea>
        {editBranchConfirmModal}
      </Theme>
    </RoleGuard>
  )
}
