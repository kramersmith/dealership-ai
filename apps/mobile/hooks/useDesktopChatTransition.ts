import { useCallback, useEffect, useRef, useState } from 'react'
import { Animated } from 'react-native'
import type { DealState } from '@/lib/types'
import { USE_NATIVE_DRIVER } from '@/lib/platform'

/**
 * Default insights width when one isn't supplied. Kept as a fallback for callers
 * that haven't yet wired the responsive `insightsWidth` prop.
 */
export const DESKTOP_INSIGHTS_WIDTH = 460
const DESKTOP_ENTER_DURATION = 260
const DESKTOP_EXIT_DURATION = 220
const DESKTOP_FADE_IN_DURATION = 220
const DESKTOP_FADE_OUT_DURATION = 180

interface UseDesktopChatTransitionArgs {
  dealState: DealState | null
  enabled: boolean
  panelExpanded: boolean
  onBackComplete: () => void
  onResetComplete: () => void
  /** Live insights panel width — drives both the chat-rail inset and the slide-in transform. */
  insightsWidth?: number
}

export function useDesktopChatTransition({
  dealState,
  enabled,
  panelExpanded,
  onBackComplete,
  onResetComplete,
  insightsWidth = DESKTOP_INSIGHTS_WIDTH,
}: UseDesktopChatTransitionArgs) {
  const backTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [isInsightsVisible, setIsInsightsVisible] = useState(false)
  const [isClosingChat, setIsClosingChat] = useState(false)
  const [isNavigatingBack, setIsNavigatingBack] = useState(false)
  const [insightsDealState, setInsightsDealState] = useState<DealState | null>(null)
  const [scrollbarOpacity, setScrollbarOpacity] = useState(1)

  const insightsOpacity = useRef(new Animated.Value(0)).current
  const insightsTranslateX = useRef(new Animated.Value(insightsWidth)).current
  const chatInset = useRef(new Animated.Value(0)).current
  const chatOpacity = useRef(new Animated.Value(1)).current

  const showInsights =
    enabled && panelExpanded && !isClosingChat && !isNavigatingBack && !!dealState

  useEffect(() => {
    return () => {
      if (backTimeoutRef.current) clearTimeout(backTimeoutRef.current)
      if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      chatOpacity.setValue(1)
      chatInset.setValue(0)
      insightsOpacity.setValue(0)
      insightsTranslateX.setValue(insightsWidth)
      setIsInsightsVisible(false)
      setInsightsDealState(null)
      setScrollbarOpacity(1)
      return
    }

    const listenerId = chatInset.addListener(({ value }) => {
      setScrollbarOpacity(Math.max(0, Math.min(1, value / Math.max(1, insightsWidth))))
    })

    return () => {
      chatInset.removeListener(listenerId)
    }
  }, [chatInset, chatOpacity, enabled, insightsOpacity, insightsTranslateX, insightsWidth])

  useEffect(() => {
    if (showInsights && dealState) {
      setInsightsDealState(dealState)
    }
  }, [dealState, showInsights])

  // Pass live `dealState` into InsightsPanel whenever the sidebar is "active" (`showInsights`) so
  // panel cards + chatStore `insightsPanelCommitGeneration` update in the same commit (the old
  // useEffect mirror lagged one frame and broke the strip animation / mockPanel).
  // During exit (`showInsights` false but `isInsightsVisible` true), keep the last mirrored deal
  // so the sliding panel does not flash empty before unmount.
  const insightsDealStateForPanel: DealState | null =
    showInsights && dealState ? dealState : isInsightsVisible ? insightsDealState : null

  // Slide animation — only triggers on showInsights transition, not on dealState updates.
  // Track whether insights have ever been shown so we don't run the exit animation on
  // initial mount (which would fade chatOpacity to 0).
  const wasInsightsShownRef = useRef(false)

  useEffect(() => {
    if (showInsights) {
      wasInsightsShownRef.current = true
      setIsInsightsVisible(true)
      chatOpacity.setValue(1)
      insightsOpacity.setValue(0)
      insightsTranslateX.setValue(insightsWidth)
      chatInset.setValue(0)
      Animated.parallel([
        Animated.timing(insightsOpacity, {
          toValue: 1,
          duration: DESKTOP_FADE_IN_DURATION,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(insightsTranslateX, {
          toValue: 0,
          duration: DESKTOP_ENTER_DURATION,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(chatInset, {
          toValue: insightsWidth,
          duration: DESKTOP_ENTER_DURATION,
          useNativeDriver: false,
        }),
        Animated.timing(chatOpacity, {
          toValue: 1,
          duration: DESKTOP_FADE_IN_DURATION,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]).start()
      return
    }

    // Only run exit animation if insights were previously shown
    if (!wasInsightsShownRef.current) return

    Animated.parallel([
      Animated.timing(insightsOpacity, {
        toValue: 0,
        duration: DESKTOP_FADE_OUT_DURATION,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(insightsTranslateX, {
        toValue: insightsWidth,
        duration: DESKTOP_EXIT_DURATION,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(chatInset, {
        toValue: 0,
        duration: DESKTOP_EXIT_DURATION,
        useNativeDriver: false,
      }),
      Animated.timing(chatOpacity, {
        toValue: 1,
        duration: DESKTOP_FADE_OUT_DURATION,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setIsInsightsVisible(false)
        setInsightsDealState(null)
      }
    })
  }, [chatInset, chatOpacity, insightsOpacity, insightsTranslateX, showInsights])

  const beginBackNavigation = useCallback(() => {
    setIsNavigatingBack(true)
    if (backTimeoutRef.current) clearTimeout(backTimeoutRef.current)
    backTimeoutRef.current = setTimeout(() => {
      onBackComplete()
      backTimeoutRef.current = null
    }, DESKTOP_EXIT_DURATION)
  }, [onBackComplete])

  const beginChatReset = useCallback(() => {
    setIsClosingChat(true)
    if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current)
    resetTimeoutRef.current = setTimeout(() => {
      onResetComplete()
      setIsClosingChat(false)
      resetTimeoutRef.current = null
    }, DESKTOP_EXIT_DURATION)
  }, [onResetComplete])

  return {
    beginBackNavigation,
    beginChatReset,
    chatInset,
    chatOpacity,
    insightsDealState: insightsDealStateForPanel,
    insightsOpacity,
    insightsTranslateX,
    isInsightsVisible,
    scrollbarOpacity,
    showInsights,
  }
}
