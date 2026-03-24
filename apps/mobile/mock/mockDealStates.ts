import type { DealState } from '@/lib/types'
import { EMPTY_DEAL_NUMBERS, EMPTY_SCORECARD } from '@/lib/constants'

export function createEmptyDealState(sessionId: string): DealState {
  return {
    sessionId,
    phase: 'research',
    numbers: { ...EMPTY_DEAL_NUMBERS },
    vehicle: null,
    scorecard: { ...EMPTY_SCORECARD },
    checklist: [],
    timerStartedAt: null,
  }
}

export const MOCK_DEAL_STATE_NEGOTIATION: DealState = {
  sessionId: 'session-1',
  phase: 'negotiation',
  numbers: {
    msrp: 34000,
    invoicePrice: 31500,
    theirOffer: 33500,
    yourTarget: 31000,
    walkAwayPrice: 33000,
    currentOffer: 33500,
    monthlyPayment: 560,
    apr: 7.99,
    loanTermMonths: 60,
    downPayment: 2000,
    tradeInValue: null,
  },
  vehicle: {
    year: 2022,
    make: 'Ford',
    model: 'F-250',
    trim: 'Lariat',
    vin: '1FT7W2BN0NED52782',
    mileage: 175000,
    color: 'Black',
  },
  scorecard: {
    price: 'yellow',
    financing: 'red',
    tradeIn: null,
    fees: 'yellow',
    overall: 'yellow',
  },
  checklist: [
    { label: 'Get out-the-door price in writing', done: true },
    { label: 'Check market value', done: true },
    { label: 'Inspect vehicle (undercarriage, tires, hitch)', done: true },
    { label: 'Test drive (transmission, brakes, suspension)', done: true },
    { label: 'Verify APR against your credit profile', done: false },
    { label: 'Decline unwanted add-ons in F&I', done: false },
    { label: 'Compare final contract to verbal agreement', done: false },
  ],
  timerStartedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(), // 1.5 hours ago
}
