import { useCallback, useEffect, useState } from 'react'
import { Platform } from 'react-native'

const DESKTOP_PANEL_STORAGE_KEY = 'dealership-ai.desktop-insights-collapsed'

function readStoredDesktopPanelCollapsed(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return false
  }

  try {
    // Clear any stale preference so the panel always defaults to expanded.
    // Earlier test runs may have collapsed it via the close button.
    window.localStorage.removeItem(DESKTOP_PANEL_STORAGE_KEY)
  } catch {
    // ignore
  }

  return false
}

export function useDesktopPanelPreference() {
  const [desktopInsightsCollapsed, setDesktopInsightsCollapsedState] = useState<boolean>(() =>
    readStoredDesktopPanelCollapsed()
  )

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== DESKTOP_PANEL_STORAGE_KEY) return
      setDesktopInsightsCollapsedState(event.newValue === '1')
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const setDesktopInsightsCollapsed = useCallback((collapsed: boolean) => {
    setDesktopInsightsCollapsedState(collapsed)

    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return
    }

    try {
      if (collapsed) {
        window.localStorage.setItem(DESKTOP_PANEL_STORAGE_KEY, '1')
      } else {
        window.localStorage.removeItem(DESKTOP_PANEL_STORAGE_KEY)
      }
    } catch {
      // Ignore storage write failures; the in-memory state still updates this session.
    }
  }, [])

  return {
    desktopInsightsCollapsed,
    setDesktopInsightsCollapsed,
  }
}
