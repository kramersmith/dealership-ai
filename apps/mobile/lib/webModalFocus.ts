import { Platform } from 'react-native'

function isModalFocusDebugEnabled(): boolean {
  if (typeof __DEV__ === 'undefined' || !__DEV__ || Platform.OS !== 'web') return false
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('DEBUG_A11Y_MODAL') === '1'
  } catch {
    return false
  }
}

function logModalFocus(phase: string, elementIds: string[], extra: Record<string, unknown> = {}) {
  if (!isModalFocusDebugEnabled()) return
  const found = elementIds.map((id) => ({
    id,
    element: typeof document !== 'undefined' ? document.getElementById(id) : null,
  }))
  console.debug('[a11y:modal-focus]', phase, {
    ...extra,
    elementIds,
    found: found.map(({ id, element }) => ({ id, tag: element?.tagName ?? null })),
    activeElement: typeof document !== 'undefined' ? document.activeElement?.tagName : null,
  })
}

/**
 * RN Web opens Modal in a portal and hides the rest of the app. After `onShow`, move focus
 * into the portal so keyboard / SR users aren’t left on `document.body` (root layout’s
 * `useWebAriaHiddenFocusWorkaround` already blurs focus trapped in the `aria-hidden` shell).
 *
 * Tries each id in order; retries if Tamagui hasn’t attached the DOM id yet.
 */
export function focusDomElementByIdsAfterModalShow(...elementIds: string[]) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return

  const tryFocus = (phase: string) => {
    for (const id of elementIds) {
      const element = document.getElementById(id) as HTMLElement | null
      if (element && typeof element.focus === 'function') {
        element.focus({ preventScroll: true })
        logModalFocus(phase, elementIds, { focusedId: id })
        return true
      }
    }
    logModalFocus(phase, elementIds, { focusedId: null })
    return false
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (tryFocus('after-2x-rAF')) return
      window.setTimeout(() => {
        if (tryFocus('after-50ms-retry')) return
        window.setTimeout(() => tryFocus('after-150ms-retry'), 100)
      }, 50)
    })
  })
}
