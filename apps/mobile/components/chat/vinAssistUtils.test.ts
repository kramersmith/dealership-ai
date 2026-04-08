import { describe, expect, it } from 'vitest'

import type { VinAssistItem } from '@/lib/types'

import { vinAssistVehicleLabel } from './vinAssistUtils'

const baseItem: VinAssistItem = {
  id: 'v1',
  sessionId: 's1',
  vin: '1HGBH41JXMN109186',
  sourceMessageId: 'm1',
  status: 'detected',
  updatedAt: new Date().toISOString(),
}

describe('vinAssistVehicleLabel', () => {
  it('returns the raw VIN when the item has no decoded vehicle', () => {
    expect(vinAssistVehicleLabel(baseItem)).toBe('1HGBH41JXMN109186')
  })

  it('joins year/make/model/trim when decoded', () => {
    expect(
      vinAssistVehicleLabel({
        ...baseItem,
        decodedVehicle: {
          year: 2021,
          make: 'Honda',
          model: 'Civic',
          trim: 'EX',
          partial: false,
        },
      })
    ).toBe('2021 Honda Civic EX')
  })

  it('skips missing fields in the decoded label', () => {
    expect(
      vinAssistVehicleLabel({
        ...baseItem,
        decodedVehicle: { year: 2019, make: 'Ford', model: 'F-150', partial: false },
      })
    ).toBe('2019 Ford F-150')
  })

  it('falls back gracefully when decodedVehicle has no usable fields', () => {
    expect(
      vinAssistVehicleLabel({
        ...baseItem,
        decodedVehicle: { partial: true },
      })
    ).toBe('')
  })
})
