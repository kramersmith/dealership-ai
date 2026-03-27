import { create } from 'zustand'
import type {
  BuyerContext,
  DealState,
  DealHealth,
  DealPhase,
  DealNumbers,
  RedFlag,
  InformationGap,
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

  /** IDs of red flags the user has dismissed (ephemeral, clears on session change). */
  dismissedFlagIds: Set<string>

  loadDealState: (sessionId: string) => Promise<void>
  resetDealState: (sessionId: string, buyerContext?: BuyerContext) => void
  applyToolCall: (toolCall: ToolCall) => void

  // Direct setters
  toggleChecklistItem: (index: number) => void
  startTimer: () => void
  dismissRedFlag: (id: string) => void

  /** Correct a deal field inline. Updates locally immediately, debounces backend call. */
  correctNumber: (field: keyof DealNumbers, value: number | null) => void
  correctVehicleField: (field: keyof Vehicle, value: string | number | undefined) => void
}

/** Debounce timer for backend correction calls. */
let correctionTimer: ReturnType<typeof setTimeout> | null = null
/** Accumulated corrections waiting to be sent to backend. */
let pendingCorrections: Record<string, string | number | null> = {}

function debouncedSendCorrections(sessionId: string, set: any, get: any) {
  if (correctionTimer) clearTimeout(correctionTimer)
  correctionTimer = setTimeout(async () => {
    const corrections = { ...pendingCorrections }
    pendingCorrections = {}
    correctionTimer = null

    try {
      const result = await api.correctDealState(sessionId, corrections)
      const { dealState } = get()
      if (!dealState || dealState.sessionId !== sessionId) return

      // Apply Haiku re-assessment
      const updates: Partial<DealState> = {}
      if (result.healthStatus !== null) {
        updates.health = {
          status: result.healthStatus as any,
          summary: result.healthSummary ?? '',
          recommendation: result.recommendation ?? null,
        }
      }
      if (result.redFlags.length > 0 || dealState.redFlags.length > 0) {
        updates.redFlags = result.redFlags
      }
      if (Object.keys(updates).length > 0) {
        set({ dealState: { ...get().dealState, ...updates } })
      }
    } catch {
      // Correction API failed — local state is already updated, will sync on next load
    }
  }, 1500)
}

/** Map camelCase DealNumbers field to snake_case backend field. */
const NUMBER_FIELD_MAP: Record<keyof DealNumbers, string> = {
  msrp: 'msrp',
  invoicePrice: 'invoice_price',
  listingPrice: 'listing_price',
  yourTarget: 'your_target',
  walkAwayPrice: 'walk_away_price',
  currentOffer: 'current_offer',
  monthlyPayment: 'monthly_payment',
  apr: 'apr',
  loanTermMonths: 'loan_term_months',
  downPayment: 'down_payment',
  tradeInValue: 'trade_in_value',
}

/** Map camelCase Vehicle field to snake_case backend field. */
const VEHICLE_FIELD_MAP: Record<keyof Vehicle, string> = {
  year: 'vehicle_year',
  make: 'vehicle_make',
  model: 'vehicle_model',
  trim: 'vehicle_trim',
  vin: 'vehicle_vin',
  mileage: 'vehicle_mileage',
  color: 'vehicle_color',
}

export const useDealStore = create<DealStore>((set, get) => ({
  dealState: null,
  isLoading: false,
  dismissedFlagIds: new Set(),

  loadDealState: async (sessionId) => {
    set({ isLoading: true })
    try {
      const state = await api.getDealState(sessionId)
      set({ dealState: state, isLoading: false, dismissedFlagIds: new Set() })
    } catch {
      set({ isLoading: false })
    }
  },

  resetDealState: (sessionId, buyerContext = DEFAULT_BUYER_CONTEXT) => {
    const initialPhase =
      buyerContext === 'at_dealership'
        ? 'initial_contact'
        : buyerContext === 'reviewing_deal'
          ? 'negotiation'
          : 'research'

    set({
      dealState: {
        sessionId,
        phase: initialPhase,
        buyerContext,
        numbers: { ...EMPTY_DEAL_NUMBERS },
        vehicle: null,
        scorecard: { ...EMPTY_SCORECARD },
        checklist: [],
        timerStartedAt: null,
        health: null,
        redFlags: [],
        informationGaps: [],
        firstOffer: null,
        preFiPrice: null,
        savingsEstimate: null,
      },
      dismissedFlagIds: new Set(),
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

      case 'update_deal_health': {
        const health: DealHealth = {
          status: toolCall.args.status,
          summary: toolCall.args.summary,
          recommendation: toolCall.args.recommendation ?? null,
        }
        set({
          dealState: { ...dealState, health },
        })
        break
      }

      case 'update_red_flags': {
        const flags = (toolCall.args.flags ?? []) as RedFlag[]
        set({
          dealState: { ...dealState, redFlags: flags },
        })
        break
      }

      case 'update_information_gaps': {
        const gaps = (toolCall.args.gaps ?? []) as InformationGap[]
        set({
          dealState: { ...dealState, informationGaps: gaps },
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

  dismissRedFlag: (id) => {
    const { dismissedFlagIds } = get()
    const next = new Set(dismissedFlagIds)
    next.add(id)
    set({ dismissedFlagIds: next })
  },

  correctNumber: (field, value) => {
    const { dealState } = get()
    if (!dealState) return

    // Update locally immediately (Tier 1)
    set({
      dealState: {
        ...dealState,
        numbers: { ...dealState.numbers, [field]: value },
      },
    })

    // Queue for debounced backend call
    const backendField = NUMBER_FIELD_MAP[field]
    if (backendField) {
      pendingCorrections[backendField] = value
      debouncedSendCorrections(dealState.sessionId, set, get)
    }
  },

  correctVehicleField: (field, value) => {
    const { dealState } = get()
    if (!dealState) return

    // Update locally immediately
    const vehicle = dealState.vehicle
      ? { ...dealState.vehicle, [field]: value }
      : ({ [field]: value } as unknown as Vehicle)
    set({
      dealState: { ...dealState, vehicle },
    })

    // Queue for debounced backend call
    const backendField = VEHICLE_FIELD_MAP[field]
    if (backendField) {
      pendingCorrections[backendField] = value as string | number | null
      debouncedSendCorrections(dealState.sessionId, set, get)
    }
  },
}))
