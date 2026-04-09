import { afterEach, describe, expect, it, vi } from 'vitest'

import { installWebAriaHiddenFocusWorkaround } from '@/lib/webAriaHiddenFocus'

class FakeElement {
  parentElement: FakeElement | null = null
  private attributes = new Map<string, string>()
  blur = vi.fn()

  constructor(parentElement: FakeElement | null = null) {
    this.parentElement = parentElement
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }

  contains(target: unknown) {
    let current = target instanceof FakeElement ? target : null
    while (current) {
      if (current === this) return true
      current = current.parentElement
    }
    return false
  }
}

class FakeMutationObserver {
  static instance: FakeMutationObserver | null = null

  callback: MutationCallback
  observe = vi.fn()
  disconnect = vi.fn()

  constructor(callback: MutationCallback) {
    this.callback = callback
    FakeMutationObserver.instance = this
  }
}

function createFakeDocument() {
  const documentElement = new FakeElement()
  const body = new FakeElement(documentElement)
  let focusInHandler: ((event: FocusEvent) => void) | null = null

  return {
    body,
    documentElement,
    activeElement: null as unknown,
    addEventListener: vi.fn((eventName: string, handler: (event: FocusEvent) => void) => {
      if (eventName === 'focusin') focusInHandler = handler
    }),
    removeEventListener: vi.fn(),
    dispatchFocusIn(target: FakeElement) {
      focusInHandler?.({ target } as unknown as FocusEvent)
    },
  }
}

describe('installWebAriaHiddenFocusWorkaround', () => {
  afterEach(() => {
    FakeMutationObserver.instance = null
    vi.clearAllMocks()
  })

  it('blurs the active element when an ancestor becomes aria-hidden', () => {
    const fakeDocument = createFakeDocument()
    const hiddenAncestor = new FakeElement(fakeDocument.body)
    hiddenAncestor.setAttribute('aria-hidden', 'true')
    const activeElement = new FakeElement(hiddenAncestor)
    fakeDocument.activeElement = activeElement

    installWebAriaHiddenFocusWorkaround(
      fakeDocument as unknown as Document,
      FakeMutationObserver as unknown as typeof MutationObserver
    )

    FakeMutationObserver.instance?.callback(
      [
        {
          type: 'attributes',
          attributeName: 'aria-hidden',
          target: hiddenAncestor,
        } as unknown as MutationRecord,
      ],
      FakeMutationObserver.instance as unknown as MutationObserver
    )

    expect(activeElement.blur).toHaveBeenCalledTimes(1)
  })

  it('blurs focus restored into an already aria-hidden subtree', () => {
    const fakeDocument = createFakeDocument()
    const hiddenAncestor = new FakeElement(fakeDocument.body)
    hiddenAncestor.setAttribute('aria-hidden', 'true')
    const target = new FakeElement(hiddenAncestor)

    installWebAriaHiddenFocusWorkaround(
      fakeDocument as unknown as Document,
      FakeMutationObserver as unknown as typeof MutationObserver
    )

    fakeDocument.dispatchFocusIn(target)

    expect(target.blur).toHaveBeenCalledTimes(1)
  })

  it('disconnects the observer and removes the focus listener on cleanup', () => {
    const fakeDocument = createFakeDocument()

    const cleanup = installWebAriaHiddenFocusWorkaround(
      fakeDocument as unknown as Document,
      FakeMutationObserver as unknown as typeof MutationObserver
    )

    cleanup()

    expect(FakeMutationObserver.instance?.disconnect).toHaveBeenCalledTimes(1)
    expect(fakeDocument.removeEventListener).toHaveBeenCalledWith(
      'focusin',
      expect.any(Function),
      true
    )
  })
})
