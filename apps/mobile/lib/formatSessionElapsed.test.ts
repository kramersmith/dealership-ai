import { describe, expect, it } from 'vitest'
import { formatSessionElapsed } from './formatSessionElapsed'

describe('formatSessionElapsed', () => {
  it('formats zero crossing', () => {
    const t = Date.parse('2026-01-01T12:00:00.000Z')
    expect(formatSessionElapsed('2026-01-01T12:00:00.000Z', t)).toBe('00:00:00')
  })

  it('pads hours minutes seconds', () => {
    const start = Date.parse('2026-01-01T12:00:00.000Z')
    const now = start + 3661 * 1000
    expect(formatSessionElapsed('2026-01-01T12:00:00.000Z', now)).toBe('01:01:01')
  })

  it('handles invalid iso', () => {
    expect(formatSessionElapsed('not-a-date', Date.now())).toBe('00:00:00')
  })
})
