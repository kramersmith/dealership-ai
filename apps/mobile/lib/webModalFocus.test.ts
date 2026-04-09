import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
}))

import { focusDomElementByIdsAfterModalShow } from '@/lib/webModalFocus'

describe('focusDomElementByIdsAfterModalShow', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('focuses the first matching element in priority order', () => {
    const fallback = { focus: vi.fn() }
    const primary = { focus: vi.fn() }
    vi.stubGlobal('document', {
      getElementById: vi.fn((id: string) => {
        if (id === 'primary') return primary
        if (id === 'fallback') return fallback
        return null
      }),
    })
    vi.stubGlobal('window', {
      setTimeout: (fn: () => void) => {
        fn()
        return 1
      },
    })
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => {
      fn()
      return 1
    })

    focusDomElementByIdsAfterModalShow('primary', 'fallback')

    expect(primary.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(fallback.focus).not.toHaveBeenCalled()
  })

  it('retries focus when the element is attached after the initial animation frames', () => {
    const late = { focus: vi.fn() }
    let attempts = 0
    vi.stubGlobal('document', {
      getElementById: vi.fn(() => {
        attempts += 1
        return attempts >= 3 ? late : null
      }),
    })
    vi.stubGlobal('window', {
      setTimeout: (fn: () => void) => {
        fn()
        return 1
      },
    })
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => {
      fn()
      return 1
    })

    focusDomElementByIdsAfterModalShow('late')

    expect(late.focus).toHaveBeenCalledWith({ preventScroll: true })
  })
})
