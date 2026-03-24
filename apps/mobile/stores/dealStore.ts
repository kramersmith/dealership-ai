import { create } from 'zustand'
import type { DealState, DealPhase, DealNumbers, Scorecard, Vehicle, ChecklistItem, ToolCall } from '@/lib/types'
import { EMPTY_DEAL_NUMBERS, EMPTY_SCORECARD } from '@/lib/constants'
import { api } from '@/lib/api'

interface DealStore {
  dealState: DealState | null
  isLoading: boolean

  loadDealState: (sessionId: string) => Promise<void>
  resetDealState: (sessionId: string) => void
  applyToolCall: (toolCall: ToolCall) => void

  // Direct setters for checklist interaction
  toggleChecklistItem: (index: number) => void
  startTimer: () => void
}

export const useDealStore = create<DealStore>((set, get) => ({
  dealState: null,
  isLoading: false,

  loadDealState: async (sessionId) => {
    set({ isLoading: true })
    try {
      const state = await api.getDealState(sessionId)
      set({ dealState: state, isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },

  resetDealState: (sessionId) => {
    set({
      dealState: {
        sessionId,
        phase: 'research',
        numbers: { ...EMPTY_DEAL_NUMBERS },
        vehicle: null,
        scorecard: { ...EMPTY_SCORECARD },
        checklist: [],
        timerStartedAt: null,
      },
    })
  },

  applyToolCall: (toolCall) => {
    const { dealState } = get()
    if (!dealState) return

    switch (toolCall.name) {
      case 'update_deal_numbers': {
        const updates: Partial<DealNumbers> = {}
        const args = toolCall.args
        if (args.msrp !== undefined) updates.msrp = args.msrp
        if (args.invoicePrice !== undefined) updates.invoicePrice = args.invoicePrice
        if (args.theirOffer !== undefined) updates.theirOffer = args.theirOffer
        if (args.yourTarget !== undefined) updates.yourTarget = args.yourTarget
        if (args.walkAwayPrice !== undefined) updates.walkAwayPrice = args.walkAwayPrice
        if (args.currentOffer !== undefined) updates.currentOffer = args.currentOffer
        if (args.monthlyPayment !== undefined) updates.monthlyPayment = args.monthlyPayment
        if (args.apr !== undefined) updates.apr = args.apr
        if (args.loanTermMonths !== undefined) updates.loanTermMonths = args.loanTermMonths
        if (args.downPayment !== undefined) updates.downPayment = args.downPayment
        if (args.tradeInValue !== undefined) updates.tradeInValue = args.tradeInValue
        set({
          dealState: {
            ...dealState,
            numbers: { ...dealState.numbers, ...updates },
          },
        })
        break
      }

      case 'update_deal_phase': {
        set({
          dealState: {
            ...dealState,
            phase: toolCall.args.phase as DealPhase,
          },
        })
        break
      }

      case 'update_scorecard': {
        const updates: Partial<Scorecard> = {}
        const args = toolCall.args
        if (args.price !== undefined) updates.price = args.price
        if (args.financing !== undefined) updates.financing = args.financing
        if (args.tradeIn !== undefined) updates.tradeIn = args.tradeIn
        if (args.fees !== undefined) updates.fees = args.fees
        if (args.overall !== undefined) updates.overall = args.overall
        set({
          dealState: {
            ...dealState,
            scorecard: { ...dealState.scorecard, ...updates },
          },
        })
        break
      }

      case 'set_vehicle': {
        const args = toolCall.args
        const vehicle: Vehicle = {
          year: args.year,
          make: args.make,
          model: args.model,
          trim: args.trim,
          vin: args.vin,
          mileage: args.mileage,
          color: args.color,
        }
        set({
          dealState: { ...dealState, vehicle },
        })
        break
      }

      case 'update_checklist': {
        const items = toolCall.args.items as ChecklistItem[]
        set({
          dealState: { ...dealState, checklist: items },
        })
        break
      }
    }
  },

  toggleChecklistItem: (index) => {
    const { dealState } = get()
    if (!dealState) return
    const checklist = [...dealState.checklist]
    if (checklist[index]) {
      checklist[index] = { ...checklist[index], done: !checklist[index].done }
    }
    set({ dealState: { ...dealState, checklist } })
  },

  startTimer: () => {
    const { dealState } = get()
    if (!dealState) return
    set({
      dealState: { ...dealState, timerStartedAt: new Date().toISOString() },
    })
  },
}))
