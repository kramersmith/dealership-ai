import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Animated } from 'react-native'
import type { DealState } from '@/lib/types'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { useDesktopChatTransition } from '@/hooks/useDesktopChatTransition'

const LAUNCHER_SLIDE_OFFSET = 12
const LAUNCHER_ANIMATION_MS = 180

export type DesktopPanelShellState = 'expanded' | 'collapsed_updating' | 'collapsed_idle' | 'hidden'

interface UseDesktopInsightsShellArgs {
  dealState: DealState | null
  enabled: boolean
  desktopInsightsCollapsed: boolean
  isPanelAnalyzing: boolean
  prefersReducedMotion: boolean
  onCollapseChange: (collapsed: boolean) => void
  onBackComplete: () => void
  onResetComplete: () => void
  /** Live insights panel width — fed through to the chat-rail inset animation. */
  insightsWidth?: number
}

export function useDesktopInsightsShell({
  dealState,
  enabled,
  desktopInsightsCollapsed,
  isPanelAnalyzing,
  prefersReducedMotion,
  onCollapseChange,
  onBackComplete,
  onResetComplete,
  insightsWidth,
}: UseDesktopInsightsShellArgs) {
  const shellState = useMemo<DesktopPanelShellState>(() => {
    if (!enabled || !dealState) {
      return 'hidden'
    }
    if (!desktopInsightsCollapsed) {
      return 'expanded'
    }
    return isPanelAnalyzing ? 'collapsed_updating' : 'collapsed_idle'
  }, [dealState, desktopInsightsCollapsed, enabled, isPanelAnalyzing])

  const showLauncher = shellState === 'collapsed_idle' || shellState === 'collapsed_updating'

  const launcherOpacity = useRef(new Animated.Value(showLauncher ? 1 : 0)).current
  const launcherTranslateX = useRef(
    new Animated.Value(showLauncher ? 0 : LAUNCHER_SLIDE_OFFSET)
  ).current

  useEffect(() => {
    if (prefersReducedMotion) {
      launcherOpacity.setValue(showLauncher ? 1 : 0)
      launcherTranslateX.setValue(showLauncher ? 0 : LAUNCHER_SLIDE_OFFSET)
      return
    }

    Animated.parallel([
      Animated.timing(launcherOpacity, {
        toValue: showLauncher ? 1 : 0,
        duration: LAUNCHER_ANIMATION_MS,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(launcherTranslateX, {
        toValue: showLauncher ? 0 : LAUNCHER_SLIDE_OFFSET,
        duration: LAUNCHER_ANIMATION_MS,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]).start()
  }, [launcherOpacity, launcherTranslateX, prefersReducedMotion, showLauncher])

  const transition = useDesktopChatTransition({
    dealState,
    enabled,
    panelExpanded: shellState === 'expanded',
    onBackComplete,
    onResetComplete,
    insightsWidth,
  })

  const collapsePanel = useCallback(() => {
    onCollapseChange(true)
  }, [onCollapseChange])

  const expandPanel = useCallback(() => {
    onCollapseChange(false)
  }, [onCollapseChange])

  return {
    collapsePanel,
    expandPanel,
    launcherOpacity,
    launcherTranslateX,
    shellState,
    showLauncher,
    transition,
  }
}
