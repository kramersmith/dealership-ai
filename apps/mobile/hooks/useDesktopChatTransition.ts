import { useCallback, useEffect, useRef, useState } from 'react'
import { Animated } from 'react-native'
import type { DealState } from '@/lib/types'
import { USE_NATIVE_DRIVER } from '@/lib/platform'

export const DESKTOP_INSIGHTS_WIDTH = 360
const DESKTOP_ENTER_DURATION = 260
const DESKTOP_EXIT_DURATION = 220
const DESKTOP_FADE_IN_DURATION = 220
const DESKTOP_FADE_OUT_DURATION = 180

interface UseDesktopChatTransitionArgs {
  dealState: DealState | null
  enabled: boolean
  onBackComplete: () => void
  onResetComplete: () => void
}

export function useDesktopChatTransition({
  dealState,
  enabled,
  onBackComplete,
  onResetComplete,
}: UseDesktopChatTransitionArgs) {
  const backTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [isInsightsVisible, setIsInsightsVisible] = useState(false)
  const [isClosingChat, setIsClosingChat] = useState(false)
  const [isNavigatingBack, setIsNavigatingBack] = useState(false)
  const [insightsDealState, setInsightsDealState] = useState<DealState | null>(null)
  const [scrollbarOpacity, setScrollbarOpacity] = useState(1)

  const insightsOpacity = useRef(new Animated.Value(0)).current
  const insightsTranslateX = useRef(new Animated.Value(DESKTOP_INSIGHTS_WIDTH)).current
  const chatInset = useRef(new Animated.Value(0)).current
  const chatOpacity = useRef(new Animated.Value(1)).current

  const showInsights = enabled && !isClosingChat && !isNavigatingBack && !!dealState

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
      insightsTranslateX.setValue(DESKTOP_INSIGHTS_WIDTH)
      setIsInsightsVisible(false)
      setInsightsDealState(null)
      setScrollbarOpacity(1)
      return
    }

    const listenerId = chatInset.addListener(({ value }) => {
      setScrollbarOpacity(Math.max(0, Math.min(1, value / DESKTOP_INSIGHTS_WIDTH)))
    })

    return () => {
      chatInset.removeListener(listenerId)
    }
  }, [chatInset, chatOpacity, enabled, insightsOpacity, insightsTranslateX])

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
      insightsTranslateX.setValue(DESKTOP_INSIGHTS_WIDTH)
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
          toValue: DESKTOP_INSIGHTS_WIDTH,
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
        toValue: DESKTOP_INSIGHTS_WIDTH,
        duration: DESKTOP_EXIT_DURATION,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(chatInset, {
        toValue: 0,
        duration: DESKTOP_EXIT_DURATION,
        useNativeDriver: false,
      }),
      Animated.timing(chatOpacity, {
        toValue: 0,
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
