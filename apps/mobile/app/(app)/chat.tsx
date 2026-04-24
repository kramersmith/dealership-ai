import { useRef, useState, useEffect, useMemo, useCallback } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Pressable,
  Modal,
  View,
  Animated,
  Dimensions,
  Easing,
  StyleSheet,
} from 'react-native'
import { YStack, XStack, Text, Theme, useTheme, useThemeName, Button } from 'tamagui'
import {
  ConfirmModal,
  ThemedSafeArea,
  LoadingIndicator,
  RoleGuard,
  ScreenHeader,
  HeaderIconButton,
} from '@/components/shared'
import {
  MessageSquarePlus,
  Pause,
  Sparkles,
  X,
  ChevronLeft,
  ChevronRight,
  History,
} from '@tamagui/lucide-icons'
import { palette } from '@/lib/theme/tokens'
import {
  APP_NAME,
  DEFAULT_BUYER_CONTEXT,
  INSIGHTS_COLLAPSED_PREVIEW_UPDATING,
  MOBILE_INSIGHTS_WIDTH_RATIO,
  MOBILE_INSIGHTS_MAX_WIDTH,
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
  CHAT_SCREEN_LAYOUT,
  getChatBottomPadding,
  getContextPickerBottomPadding,
  getDesktopChatRailStyle,
  getWebQueuePreviewRightInsetPx,
} from '@/lib/chatLayout'
import type { BuyerContext, Message, VinAssistItem } from '@/lib/types'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { focusDomElementByIdsAfterModalShow } from '@/lib/webModalFocus'
import { getVehicleAwareHeaderTitleInfo } from '@/lib/headerTitles'
import {
  dealPhaseSuggestsRecapTimeline,
  userMessageSuggestsPurchaseComplete,
} from '@/lib/recapPurchasePrompt'
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
  DesktopInsightsDockControl,
  InsightPanelPreviewIcons,
  InsightsPreviewItemChip,
  describePanelIconKindsForA11y,
} from '@/components/insights-panel'
import {
  ChatComposerOverlay,
  ChatMessageList,
  ChatInput,
  ContextPicker,
  RecapTimelinePromptBanner,
} from '@/components/chat'

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
const QUEUE_PREVIEW_EXIT_MS = 220
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
        width: Platform.OS === 'web' ? CHAT_SCREEN_LAYOUT.webQueuePreviewCardWidthPx : undefined,
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

  const { isDesktop } = useScreenWidth()
  const router = useRouter()
  const isCreating = useRef(false)
  const theme = useTheme()
  const themeName = useThemeName()
  const isDarkTheme = typeof themeName === 'string' && themeName.startsWith('dark')
  const mobileInsightsWidth = useMobileInsightsWidth()
  const [isInsightsOpen, setIsInsightsOpen] = useState(false)

  const [isInsightsVisible, setIsInsightsVisible] = useState(false)
  const [mobileInsightsPreviewHeight, setMobileInsightsPreviewHeight] = useState(0)
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
  const [recapPromptDismissed, setRecapPromptDismissed] = useState(false)
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

  /** Opaque-only stops so RN never interpolates through alpha (avoids “see-through” flashes). */
  const insightsPreviewStripBg = useMemo(() => {
    const idle = (theme.backgroundStrong?.val as string) ?? '#242526'
    const brandWash = isDarkTheme
      ? ((theme.brandSubtle?.val as string) ?? palette.brandSubtle)
      : palette.brandSubtleLight
    const finishPeak = isDarkTheme ? palette.brandFinishPeakDark : palette.brandFinishPeakLight
    return { idle, brandWash, finishPeak }
  }, [isDarkTheme, theme.backgroundStrong?.val, theme.brandSubtle?.val])

  /** 0–1 drives brand overlay opacity while analyzing. */
  const insightsPulseOverlayAnim = useBreathingPulseOverlay(isPanelAnalyzing, prefersReducedMotion)

  /**
   * Finish / idle strip emphasis (opaque hex interpolate). 0 = idle, 1 = brand wash,
   * 1.5 = brighter finish peak. Held at 1 while analyzing so the steady wash doesn't flicker.
   */
  const insightsEmphasisAnim = useRef(new Animated.Value(isPanelAnalyzing ? 1 : 0)).current
  /** Subtle “lift” on the finish flash (native transform only — outer wrapper). */
  const insightsStripScaleAnim = useRef(new Animated.Value(1)).current
  /** Finish-only border “ring” (1 → ~2.5 → 1); avoids animating width during the live pulse. */
  const insightsStripBorderWidthAnim = useRef(new Animated.Value(1)).current
  /** Brief sparkle opacity settle after analysis (native opacity). */
  const insightsSparkleOpacityAnim = useRef(new Animated.Value(1)).current
  const insightsFinishFlashRef = useRef<Animated.CompositeAnimation | null>(null)
  const previousPanelAnalyzingRef = useRef(isPanelAnalyzing)

  useEffect(() => {
    const wasAnalyzing = previousPanelAnalyzingRef.current
    previousPanelAnalyzingRef.current = isPanelAnalyzing

    insightsFinishFlashRef.current?.stop()
    insightsFinishFlashRef.current = null

    if (isPanelAnalyzing) {
      // Steady-state during analysis: brand wash + neutral scale/border.
      insightsEmphasisAnim.setValue(1)
      insightsStripScaleAnim.setValue(1)
      insightsStripBorderWidthAnim.setValue(1)
      insightsSparkleOpacityAnim.setValue(1)
      return
    }

    // Reset to idle when never analyzed (or under reduced motion).
    if (!wasAnalyzing || prefersReducedMotion) {
      insightsEmphasisAnim.setValue(0)
      insightsStripScaleAnim.setValue(1)
      insightsStripBorderWidthAnim.setValue(1)
      insightsSparkleOpacityAnim.setValue(1)
      return
    }

    // Finish flash on analyzing → idle transition.
    insightsEmphasisAnim.setValue(1)
    insightsStripScaleAnim.setValue(1)
    insightsStripBorderWidthAnim.setValue(1)
    insightsSparkleOpacityAnim.setValue(1)

    const cancelHaptic = scheduleFinishFlashHaptic()

    const finishFlash = createFinishFlashSequence({
      scaleAnim: insightsStripScaleAnim,
      borderWidthAnim: insightsStripBorderWidthAnim,
      scaleTo: 1.012,
      borderWidthTo: 2.5,
      scaleUsesNativeDriver: true,
      riseExtras: [
        Animated.timing(insightsEmphasisAnim, {
          toValue: 1.5,
          duration: 320,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
      ],
      fallExtras: [
        Animated.timing(insightsEmphasisAnim, {
          toValue: 0,
          duration: 980,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
          useNativeDriver: false,
        }),
        Animated.sequence([
          Animated.timing(insightsSparkleOpacityAnim, {
            toValue: 0.86,
            duration: 240,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(insightsSparkleOpacityAnim, {
            toValue: 1,
            duration: 560,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
      ],
    })
    insightsFinishFlashRef.current = finishFlash
    finishFlash.start()

    return () => {
      cancelHaptic()
    }
  }, [
    insightsEmphasisAnim,
    insightsSparkleOpacityAnim,
    insightsStripBorderWidthAnim,
    insightsStripScaleAnim,
    isPanelAnalyzing,
    prefersReducedMotion,
  ])

  const webQueuePreviewRightInsetPx = getWebQueuePreviewRightInsetPx(Platform.OS)

  // Mobile entrance animation — fade + slide up when the chat screen mounts
  const mobileEntrance = useSlideIn(isDesktop ? 0 : 260, 40)

  // Subscribe to dealState only for mobile preview — desktop doesn't need it
  const dealState = useDealStore((state) => state.dealState)

  const dismissedFlagIds = useDealStore((state) => state.dismissedFlagIds)
  const showContextPicker = !activeSessionId && !isLoading

  useEffect(() => {
    setRecapPromptDismissed(false)
  }, [activeSessionId])

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
  const buyerContextForPreview = dealState?.buyerContext ?? DEFAULT_BUYER_CONTEXT

  const lastUserMessageContent = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m?.role === 'user') return m.content ?? ''
    }
    return ''
  }, [messages])

  const activeDealPhaseForRecap = useMemo(() => {
    if (!dealState?.activeDealId) return null
    const d = dealState.deals.find((x) => x.id === dealState.activeDealId)
    return d?.phase ?? null
  }, [dealState])

  const showRecapTimelinePrompt =
    !!activeSessionId &&
    !showContextPicker &&
    !pendingVinIntercept &&
    !editingUserMessageId &&
    !recapPromptDismissed &&
    (userMessageSuggestsPurchaseComplete(lastUserMessageContent) ||
      dealPhaseSuggestsRecapTimeline(activeDealPhaseForRecap))

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

  const desktopShell = useDesktopInsightsShell({
    dealState,
    enabled: isDesktopChatActive,
    desktopInsightsCollapsed,
    isPanelAnalyzing,
    prefersReducedMotion,
    onCollapseChange: setDesktopInsightsCollapsed,
    onBackComplete: navigateBackOrChats,
    onResetComplete: resetDesktopChatShell,
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

  const handleOpenRecap = useCallback(() => {
    if (!activeSessionId) return
    router.push(`/recap/${activeSessionId}`)
  }, [activeSessionId, router])

  const mobileChatTopInset = showMobileInsightsToggle ? mobileInsightsPreviewHeight + 8 : 8
  const previewItems = useMemo(
    () => getInsightsPreviewItems(dealState, dismissedFlagIds, buyerContextForPreview),
    [dealState, dismissedFlagIds, buyerContextForPreview]
  )

  const insightsPreviewContentSignature = useMemo(() => {
    if (isPanelAnalyzing) return 'analyzing'
    if (insightsUpdateMode === 'paused') return 'paused'
    const slice = previewItems.slice(0, MAX_INSIGHTS_PREVIEW_ITEMS)
    const parts = slice.map((item) => {
      switch (item.type) {
        case 'health':
          return `h:${item.status}`
        case 'flag':
          return `f:${item.label}`
        case 'savings':
          return `s:${item.label}`
        case 'flagCount':
          return `c:${item.count}`
        case 'text':
          return `t:${item.label}`
        default:
          return 'u'
      }
    })
    return `live:${parts.join('·')}|${panelPreviewIconKinds.join(',')}`
  }, [isPanelAnalyzing, insightsUpdateMode, panelPreviewIconKinds, previewItems])

  const {
    opacityAnim: insightsPreviewContentOpacityAnim,
    translateYAnim: insightsPreviewContentTranslateYAnim,
  } = useSignatureEntranceAnimation(insightsPreviewContentSignature, prefersReducedMotion)

  const desktopChatRailStyle = isDesktop ? getDesktopChatRailStyle() : undefined
  const composerTrayStyle = isDesktop
    ? ({
        marginHorizontal: CHAT_SCREEN_LAYOUT.desktopComposerTrayInsetPx,
        marginBottom: CHAT_SCREEN_LAYOUT.desktopComposerTrayBottomPx,
        borderRadius: CHAT_SCREEN_LAYOUT.desktopComposerTrayRadiusPx,
        borderWidth: 1,
        borderColor: theme.borderColor?.val as string,
        backgroundColor: theme.backgroundStrong?.val as string,
        overflow: 'hidden',
        boxShadow: `0 10px 26px ${theme.shadowColor?.val ?? palette.shadowOverlay}`,
      } as const)
    : ({
        marginHorizontal: CHAT_SCREEN_LAYOUT.mobileComposerTrayInsetPx,
        marginBottom: 0,
        paddingBottom: CHAT_SCREEN_LAYOUT.mobileComposerTrayBottomPx,
        borderTopLeftRadius: CHAT_SCREEN_LAYOUT.mobileComposerTrayRadiusPx,
        borderTopRightRadius: CHAT_SCREEN_LAYOUT.mobileComposerTrayRadiusPx,
        borderTopWidth: 1,
        borderTopColor: theme.borderColor?.val as string,
        backgroundColor: theme.backgroundStrong?.val as string,
        overflow: 'hidden',
        shadowColor: theme.shadowColor?.val ?? palette.shadowOverlay,
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.2,
        shadowRadius: 20,
        elevation: 10,
      } as any)
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
      rightContent={
        activeSessionId ? (
          <XStack gap="$2" alignItems="center">
            <HeaderIconButton onPress={handleOpenRecap} accessibilityLabel="Deal recap timeline">
              <History size={22} color="$color" />
            </HeaderIconButton>
            <HeaderIconButton onPress={handleNewSession} accessibilityLabel="Start new chat">
              <MessageSquarePlus size={22} color="$color" />
            </HeaderIconButton>
          </XStack>
        ) : (
          <HeaderIconButton onPress={handleNewSession} accessibilityLabel="Start new chat">
            <MessageSquarePlus size={22} color="$color" />
          </HeaderIconButton>
        )
      }
    />
  )

  const mobileInsightsPreview =
    showMobileInsightsToggle && dealState ? (
      <Pressable
        onPress={() => setIsInsightsOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={collapsedInsightsAccessibilityLabel}
        style={({ pressed }) => ({
          marginHorizontal: 12,
          marginTop: 8,
          marginBottom: 6,
          height: 44,
          opacity: pressed ? 0.94 : 1,
          transform: [{ scale: pressed ? 0.992 : 1 }],
          borderWidth: 0,
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
        <Animated.View
          style={{
            width: '100%',
            transform: [{ scale: insightsStripScaleAnim }],
          }}
        >
          <Animated.View
            style={[
              {
                width: '100%',
                height: 44,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 10,
                overflow: 'hidden',
                borderRadius: 14,
                position: 'relative',
                ...(Platform.OS === 'web'
                  ? ({
                      boxShadow: `0 8px 28px ${theme.shadowColor?.val ?? palette.shadowOverlay}`,
                    } as any)
                  : isPanelAnalyzing
                    ? {
                        shadowColor: theme.shadowColor?.val ?? palette.shadowOverlay,
                        shadowOffset: { width: 0, height: 6 },
                        shadowOpacity: 0.22,
                        shadowRadius: 16,
                        elevation: 8,
                      }
                    : {
                        shadowColor: theme.shadowColor?.val ?? palette.shadowOverlay,
                        shadowOffset: { width: 0, height: 6 },
                        shadowOpacity: insightsEmphasisAnim.interpolate({
                          inputRange: [0, 1, 1.5],
                          outputRange: [0.14, 0.24, 0.38],
                        }),
                        shadowRadius: 16,
                        elevation: 8,
                      }),
              },
              isPanelAnalyzing
                ? {
                    borderWidth: 1,
                    backgroundColor: insightsPreviewStripBg.brandWash,
                    borderColor: palette.brand,
                  }
                : {
                    borderWidth: insightsStripBorderWidthAnim,
                    backgroundColor: insightsEmphasisAnim.interpolate({
                      inputRange: [0, 1, 1.5],
                      outputRange: [
                        insightsPreviewStripBg.idle,
                        insightsPreviewStripBg.brandWash,
                        insightsPreviewStripBg.finishPeak,
                      ],
                    }),
                    borderColor: insightsEmphasisAnim.interpolate({
                      inputRange: [0, 1, 1.5],
                      outputRange: [
                        (theme.borderColor?.val as string) ?? '#3E4042',
                        palette.brand,
                        palette.brandLight,
                      ],
                    }),
                  },
            ]}
          >
            {isPanelAnalyzing && !prefersReducedMotion ? (
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFillObject,
                  {
                    borderRadius: 14,
                    backgroundColor: palette.brand,
                    opacity: insightsPulseOverlayAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.07, 0.24],
                    }),
                  },
                ]}
              />
            ) : null}
            <XStack flexShrink={0} alignItems="center" justifyContent="center">
              <Animated.View style={{ opacity: insightsSparkleOpacityAnim }}>
                <Sparkles
                  size={22}
                  color={
                    insightsUpdateMode === 'paused' && !isPanelAnalyzing
                      ? '$placeholderColor'
                      : '$brand'
                  }
                />
              </Animated.View>
            </XStack>
            <XStack flex={1} minWidth={0} overflow="hidden">
              <Animated.View
                style={{
                  flex: 1,
                  minWidth: 0,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  gap: 10,
                  opacity: insightsPreviewContentOpacityAnim,
                  transform: [{ translateY: insightsPreviewContentTranslateYAnim }],
                }}
              >
                {isPanelAnalyzing ? (
                  <XStack flex={1} alignItems="center" minWidth={0}>
                    <Text
                      fontSize={13}
                      fontWeight="700"
                      lineHeight={18}
                      color="$color"
                      numberOfLines={1}
                      flex={1}
                      minWidth={0}
                    >
                      {INSIGHTS_COLLAPSED_PREVIEW_UPDATING}
                    </Text>
                  </XStack>
                ) : insightsUpdateMode === 'paused' ? (
                  <XStack
                    flex={1}
                    alignItems="center"
                    justifyContent="center"
                    minWidth={0}
                    gap="$1.5"
                  >
                    <Text
                      fontSize={13}
                      fontWeight="700"
                      lineHeight={18}
                      color="$placeholderColor"
                      numberOfLines={1}
                      flexShrink={1}
                      minWidth={0}
                    >
                      Paused
                    </Text>
                    <Pause size={14} color="$placeholderColor" />
                  </XStack>
                ) : (
                  previewItems
                    .slice(0, MAX_INSIGHTS_PREVIEW_ITEMS)
                    .map((item, index) => (
                      <InsightsPreviewItemChip key={`${item.type}:${index}`} item={item} />
                    ))
                )}
                {insightsUpdateMode !== 'paused' || isPanelAnalyzing ? (
                  panelPreviewIconKinds.length > 0 ? (
                    <InsightPanelPreviewIcons kinds={panelPreviewIconKinds} />
                  ) : null
                ) : null}
              </Animated.View>
            </XStack>
            <XStack opacity={0.85} flexShrink={0} alignItems="center" justifyContent="center">
              <ChevronRight
                size={18}
                color={
                  insightsUpdateMode === 'paused' && !isPanelAnalyzing
                    ? '$placeholderColor'
                    : '$brand'
                }
              />
            </XStack>
          </Animated.View>
        </Animated.View>
      </Pressable>
    ) : null

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
            : undefined
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
  const recapTimelinePromptNotice = showRecapTimelinePrompt ? (
    <RecapTimelinePromptBanner
      key="recap-timeline-prompt"
      onOpenRecap={() => {
        setRecapPromptDismissed(true)
        router.push(`/recap/${activeSessionId}`)
      }}
      onDismiss={() => setRecapPromptDismissed(true)}
    />
  ) : null

  const composerOverlayNotices = (
    <>
      {recapTimelinePromptNotice}
      {compactingNotice}
      {contextWarningNotice}
      {sendErrorNotice}
    </>
  )

  const chatColumn = (
    <View style={[{ flex: 1, overflow: 'hidden', position: 'relative' }, desktopChatRailStyle]}>
      {showContextPicker ? (
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            overflow: 'auto' as any,
            paddingBottom: getContextPickerBottomPadding({
              isDesktop,
              desktopComposerTrayHeight,
            }),
          }}
        >
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
          {mobileInsightsPreview ? (
            <YStack
              position="absolute"
              top={0}
              left={0}
              right={0}
              zIndex={2}
              style={{ pointerEvents: 'box-none' } as any}
            >
              <YStack
                onLayout={(event) => {
                  const nextHeight = Math.ceil(event.nativeEvent.layout.height)
                  if (nextHeight !== mobileInsightsPreviewHeight) {
                    setMobileInsightsPreviewHeight(nextHeight)
                  }
                }}
                style={{ pointerEvents: 'box-none' } as any}
              >
                {mobileInsightsPreview}
              </YStack>
            </YStack>
          ) : null}
        </YStack>
      )}
      <ChatComposerOverlay
        isDesktop={isDesktop}
        desktopLeftPx={CHAT_SCREEN_LAYOUT.desktopChatRailLeftGutterPx}
        desktopRightPx={webQueuePreviewRightInsetPx}
        composerTrayStyle={composerTrayStyle}
        notices={composerOverlayNotices}
        queuePreview={queuePreview}
        composer={composerControl}
        onDesktopComposerTrayHeightChange={handleDesktopComposerTrayHeightChange}
      />
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

              {desktopShell.shellState !== 'expanded' ? (
                <DesktopInsightsDockControl
                  shellState={desktopShell.shellState}
                  collapsedPrimaryText={collapsedPrimaryHeadline}
                  panelIconKinds={panelPreviewIconKinds}
                  collapsedPreviewAccessibilityLabel={collapsedInsightsAccessibilityLabel}
                  insightsUpdateMode={insightsUpdateMode}
                  prefersReducedMotion={prefersReducedMotion}
                  launcherOpacity={desktopShell.launcherOpacity}
                  launcherTranslateX={desktopShell.launcherTranslateX}
                  topOffsetPx={CHAT_SCREEN_LAYOUT.desktopDockTopOffsetPx}
                  rightOffsetPx={CHAT_SCREEN_LAYOUT.desktopDockRightOffsetPx}
                  onExpandPress={handleDesktopExpandPress}
                />
              ) : null}

              {/* AI Insights Panel — right sidebar on desktop */}
              {desktopTransition.isInsightsVisible && desktopTransition.insightsDealState ? (
                <Animated.View
                  style={{
                    position: 'absolute',
                    top: CHAT_SCREEN_LAYOUT.desktopInsightsSheetInsetPx,
                    right: 0,
                    bottom: CHAT_SCREEN_LAYOUT.desktopInsightsSheetInsetPx,
                    width: DESKTOP_INSIGHTS_WIDTH,
                    opacity: desktopTransition.insightsOpacity,
                    transform: [{ translateX: desktopTransition.insightsTranslateX }],
                  }}
                >
                  <View
                    style={{
                      width: '100%',
                      flex: 1,
                      paddingLeft: CHAT_SCREEN_LAYOUT.desktopInsightsSheetGapPx,
                    }}
                  >
                    <View style={{ flex: 1, overflow: 'visible' }}>
                      <YStack
                        flex={1}
                        backgroundColor="$backgroundStrong"
                        borderLeftWidth={1}
                        borderLeftColor="$borderColor"
                        borderTopLeftRadius={CHAT_SCREEN_LAYOUT.desktopInsightsSheetRadiusPx}
                        borderBottomLeftRadius={CHAT_SCREEN_LAYOUT.desktopInsightsSheetRadiusPx}
                        overflow="hidden"
                        {...(Platform.OS === 'web'
                          ? {
                              style: {
                                boxShadow: `-10px 0 24px ${theme.shadowColor?.val ?? palette.shadowOverlay}`,
                              },
                            }
                          : {
                              shadowColor: theme.shadowColor?.val ?? palette.shadowOverlay,
                              shadowOffset: { width: -6, height: 0 },
                              shadowOpacity: 0.18,
                              shadowRadius: 16,
                              elevation: 8,
                            })}
                      >
                        <InsightsPanel
                          dealStateOverride={desktopTransition.insightsDealState}
                          headerAccessory={
                            <Button
                              size="$3"
                              width={44}
                              minWidth={44}
                              minHeight={44}
                              paddingHorizontal="$0"
                              borderRadius="$5"
                              backgroundColor="$backgroundHover"
                              borderWidth={1}
                              borderColor="$borderColor"
                              onPress={handleDesktopCollapsePress}
                              hoverStyle={{
                                backgroundColor: '$backgroundPress',
                                borderColor: '$borderColorHover',
                              }}
                              pressStyle={{ opacity: 0.85 }}
                              {...(Platform.OS === 'web'
                                ? ({ 'aria-label': 'Collapse insights panel' } as any)
                                : { accessibilityLabel: 'Collapse insights panel' })}
                            >
                              <Animated.View
                                style={{
                                  opacity: desktopPanelCollapseEntrance.opacity,
                                  transform: [{ rotate: desktopPanelCollapseEntrance.rotate }],
                                }}
                              >
                                <X size={18} color="$color" />
                              </Animated.View>
                            </Button>
                          }
                        />
                      </YStack>
                    </View>
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
                backgroundColor="$backgroundStrong"
                borderLeftWidth={1}
                borderLeftColor="$borderColor"
                borderTopLeftRadius={CHAT_SCREEN_LAYOUT.mobileInsightsSheetRadiusPx}
                borderBottomLeftRadius={CHAT_SCREEN_LAYOUT.mobileInsightsSheetRadiusPx}
                overflow="hidden"
                {...(Platform.OS === 'web'
                  ? {
                      style: {
                        boxShadow: `-8px 0 24px ${theme.shadowColor?.val ?? palette.shadowOverlay}`,
                      },
                    }
                  : {
                      shadowColor: theme.shadowColor?.val ?? palette.shadowOverlay,
                      shadowOffset: { width: -4, height: 0 },
                      shadowOpacity: 0.24,
                      shadowRadius: 18,
                      elevation: 12,
                    })}
              >
                <ThemedSafeArea edges={['top', 'bottom']}>
                  <YStack flex={1} backgroundColor="$backgroundStrong">
                    <YStack flex={1}>
                      {dealState ? (
                        <InsightsPanel
                          headerAccessory={
                            <Button
                              size="$3"
                              width={44}
                              minWidth={44}
                              minHeight={44}
                              paddingHorizontal="$0"
                              borderRadius="$5"
                              backgroundColor="$backgroundHover"
                              borderWidth={1}
                              borderColor="$borderColor"
                              onPress={() => setIsInsightsOpen(false)}
                              hoverStyle={{
                                backgroundColor: '$backgroundPress',
                                borderColor: '$borderColorHover',
                              }}
                              pressStyle={{ opacity: 0.85 }}
                              {...(Platform.OS === 'web'
                                ? ({
                                    id: 'chat-mobile-insights-close',
                                    'aria-label': 'Close insights',
                                  } as any)
                                : { accessibilityLabel: 'Close insights' })}
                            >
                              <X size={18} color="$color" />
                            </Button>
                          }
                        />
                      ) : null}
                    </YStack>
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
