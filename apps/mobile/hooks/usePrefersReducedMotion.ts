import { useEffect, useState } from 'react'
import { AccessibilityInfo, Platform } from 'react-native'

/** True when the user prefers reduced UI motion (a11y). */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
      const sync = () => setReduced(mq.matches)
      sync()
      mq.addEventListener?.('change', sync)
      return () => mq.removeEventListener?.('change', sync)
    }

    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduced)
    void AccessibilityInfo.isReduceMotionEnabled?.().then(setReduced)
    return () => sub?.remove?.()
  }, [])

  return reduced
}
