import { useEffect } from 'react'
import { Platform } from 'react-native'

import { installWebAriaHiddenFocusWorkaround } from '@/lib/webAriaHiddenFocus'

/**
 * React Native Web marks the main app layer `aria-hidden` when a `Modal` opens. If focus
 * remains on a control in that subtree, Chrome logs a warning and assistive tech sees a
 * broken tree. `Modal.onShow` and `useLayoutEffect` can lose this race (especially with
 * tooling that patches native dialogs to be non-blocking).
 *
 * This hook defensively clears focus whenever (1) an element gains `aria-hidden="true"` and
 * contains the active element, or (2) focus moves into a subtree that already has an
 * `aria-hidden="true"` ancestor (e.g. late focus restore).
 */
export function useWebAriaHiddenFocusWorkaround() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return
    if (typeof MutationObserver === 'undefined') return

    return installWebAriaHiddenFocusWorkaround(document, MutationObserver)
  }, [])
}
