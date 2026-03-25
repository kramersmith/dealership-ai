import { create } from 'zustand'
import type {
  BuyerContext,
  DealState,
  DealPhase,
  DealNumbers,
  Scorecard,
  Vehicle,
  ChecklistItem,
  ToolCall,
} from '@/lib/types'
import { DEFAULT_BUYER_CONTEXT, EMPTY_DEAL_NUMBERS, EMPTY_SCORECARD } from '@/lib/constants'
import { snakeToCamel } from '@/lib/utils'
import { api } from '@/lib/api'

interface DealStore {
  dealState: DealState | null
  isLoading: boolean

  loadDealState: (sessionId: string) => Promise<void>
  resetDealState: (sessionId: string, buyerContext?: BuyerContext) => void
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

  resetDealState: (sessionId, buyerContext = DEFAULT_BUYER_CONTEXT) => {
    set({
      dealState: {
        sessionId,
        phase: 'research',
        buyerContext,
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
        const camelArgs = snakeToCamel(toolCall.args) as Partial<DealNumbers>
        set({
          dealState: {
            ...dealState,
            numbers: { ...dealState.numbers, ...camelArgs },
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
        // Scorecard args have score_ prefix: score_price -> price
        const camelArgs = snakeToCamel(toolCall.args)
        const updates: Partial<Scorecard> = {}
        if (camelArgs.scorePrice !== undefined) updates.price = camelArgs.scorePrice
        if (camelArgs.scoreFinancing !== undefined) updates.financing = camelArgs.scoreFinancing
        if (camelArgs.scoreTradeIn !== undefined) updates.tradeIn = camelArgs.scoreTradeIn
        if (camelArgs.scoreFees !== undefined) updates.fees = camelArgs.scoreFees
        if (camelArgs.scoreOverall !== undefined) updates.overall = camelArgs.scoreOverall
        set({
          dealState: {
            ...dealState,
            scorecard: { ...dealState.scorecard, ...updates },
          },
        })
        break
      }

      case 'set_vehicle': {
        const vehicle = snakeToCamel(toolCall.args) as Vehicle
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

      case 'update_buyer_context': {
        const camelArgs = snakeToCamel(toolCall.args)
        set({
          dealState: {
            ...dealState,
            buyerContext: camelArgs.buyerContext as BuyerContext,
          },
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
