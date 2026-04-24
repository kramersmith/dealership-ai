import { describe, expect, it } from 'vitest'
import {
  dealPhaseSuggestsRecapTimeline,
  userMessageSuggestsPurchaseComplete,
} from './recapPurchasePrompt'

describe('userMessageSuggestsPurchaseComplete', () => {
  it('matches explicit bought-the-truck phrasing', () => {
    expect(userMessageSuggestsPurchaseComplete('I bought the truck today')).toBe(true)
    expect(userMessageSuggestsPurchaseComplete('Confirming I bought the truck')).toBe(true)
  })

  it('matches picked up / delivery phrasing', () => {
    expect(userMessageSuggestsPurchaseComplete('Picked up the vehicle this morning')).toBe(true)
    expect(userMessageSuggestsPurchaseComplete('We took delivery yesterday')).toBe(true)
  })

  it('rejects vague or too-short text', () => {
    expect(userMessageSuggestsPurchaseComplete('ok')).toBe(false)
    expect(userMessageSuggestsPurchaseComplete('thinking about buying')).toBe(false)
  })
})

describe('dealPhaseSuggestsRecapTimeline', () => {
  it('is true only for closing', () => {
    expect(dealPhaseSuggestsRecapTimeline('closing')).toBe(true)
    expect(dealPhaseSuggestsRecapTimeline('negotiation')).toBe(false)
    expect(dealPhaseSuggestsRecapTimeline(null)).toBe(false)
  })
})
