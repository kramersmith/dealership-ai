function isElementLike(value: unknown): value is HTMLElement {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as HTMLElement).getAttribute === 'function' &&
    typeof (value as HTMLElement).contains === 'function'
  )
}

function isBlurrableElement(value: unknown): value is HTMLElement {
  return isElementLike(value) && typeof (value as HTMLElement).blur === 'function'
}

/**
 * Pure DOM helper extracted so it can be unit tested without pulling in the
 * react-native runtime. The React hook in `hooks/useWebAriaHiddenFocusWorkaround.ts`
 * wires this to the real `document` and `MutationObserver` on web only.
 */
export function installWebAriaHiddenFocusWorkaround(
  documentRef: Document,
  MutationObserverRef: typeof MutationObserver
) {
  const blurActiveIfInside = (ancestor: HTMLElement) => {
    const activeElement = documentRef.activeElement
    if (isBlurrableElement(activeElement) && ancestor.contains(activeElement)) {
      activeElement.blur()
    }
  }

  const onFocusInCapture = (focusEvent: FocusEvent) => {
    const target = focusEvent.target
    if (!isBlurrableElement(target)) return
    let currentAncestor: HTMLElement | null = target
    while (currentAncestor && currentAncestor !== documentRef.documentElement) {
      if (currentAncestor.getAttribute('aria-hidden') === 'true') {
        target.blur()
        return
      }
      currentAncestor = currentAncestor.parentElement
    }
  }

  const ariaHiddenObserver = new MutationObserverRef((records) => {
    for (const record of records) {
      if (record.type !== 'attributes' || record.attributeName !== 'aria-hidden') continue
      const recordTarget = record.target
      if (!isElementLike(recordTarget)) continue
      if (recordTarget.getAttribute('aria-hidden') !== 'true') continue
      blurActiveIfInside(recordTarget)
    }
  })

  ariaHiddenObserver.observe(documentRef.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-hidden'],
  })
  documentRef.addEventListener('focusin', onFocusInCapture, true)

  return () => {
    ariaHiddenObserver.disconnect()
    documentRef.removeEventListener('focusin', onFocusInCapture, true)
  }
}
