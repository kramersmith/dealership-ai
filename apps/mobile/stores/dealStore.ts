import { create } from 'zustand'
import type {
  BuyerContext,
  Deal,
  DealComparison,
  DealHealth,
  DealNumbers,
  DealPhase,
  DealState,
  AiPanelCard,
  ChecklistItem,
  InformationGap,
  NegotiationContext,
  RedFlag,
  Scorecard,
  ToolCall,
  Vehicle,
  VehicleRole,
} from '@/lib/types'
import { EMPTY_DEAL_NUMBERS, EMPTY_SCORECARD } from '@/lib/constants'
import { generateId, snakeToCamel } from '@/lib/utils'
import { api } from '@/lib/api'

interface DealStore {
  dealState: DealState | null
  isLoading: boolean

  /** IDs of red flags the user has dismissed (ephemeral, clears on session change). */
  dismissedFlagIds: Set<string>

  loadDealState: (sessionId: string) => Promise<void>
  resetDealState: (sessionId: string, buyerContext?: BuyerContext) => void
  applyToolCall: (toolCall: ToolCall) => void
  applyToolCalls: (toolCalls: ToolCall[]) => void

  // Direct setters
  startTimer: () => void
  dismissRedFlag: (id: string) => void

  /** Correct a deal number inline. Updates locally immediately, debounces backend call. */
  correctNumber: (dealId: string, field: keyof DealNumbers, value: number | null) => void
  /** Correct a vehicle field inline. Updates locally immediately, debounces backend call. */
  correctVehicleField: (
    vehicleId: string,
    field: keyof Vehicle,
    value: string | number | undefined
  ) => void
}

/** Debounce timer for backend correction calls. */
let correctionTimer: ReturnType<typeof setTimeout> | null = null

/** Accumulated corrections waiting to be sent to backend. */
let pendingVehicleCorrections: Map<string, Record<string, string | number | null>> = new Map()
let pendingDealCorrections: Map<string, Record<string, string | number | null>> = new Map()

function debouncedSendCorrections(sessionId: string, set: any, get: any) {
  if (correctionTimer) clearTimeout(correctionTimer)
  correctionTimer = setTimeout(async () => {
    const vehicleCorrections = Array.from(pendingVehicleCorrections.entries()).map(
      ([vehicleId, fields]) => ({ vehicleId, ...fields })
    )
    const dealCorrections = Array.from(pendingDealCorrections.entries()).map(
      ([dealId, fields]) => ({ dealId, ...fields })
    )
    pendingVehicleCorrections = new Map()
    pendingDealCorrections = new Map()
    correctionTimer = null

    try {
      const result = await api.correctDealState(sessionId, {
        vehicleCorrections: vehicleCorrections.length > 0 ? vehicleCorrections : undefined,
        dealCorrections: dealCorrections.length > 0 ? dealCorrections : undefined,
      })
      const { dealState } = get()
      if (!dealState || dealState.sessionId !== sessionId) return

      // Apply Haiku re-assessment to the relevant deal
      if (result.dealId && result.healthStatus !== null) {
        const deals = dealState.deals.map((d: Deal) => {
          if (d.id !== result.dealId) return d
          const updates: Partial<Deal> = {}
          updates.health = {
            status: result.healthStatus as any,
            summary: result.healthSummary ?? '',
            recommendation: result.recommendation ?? null,
          }
          if (result.redFlags.length > 0 || d.redFlags.length > 0) {
            updates.redFlags = result.redFlags
          }
          return { ...d, ...updates }
        })
        set({ dealState: { ...get().dealState, deals } })
      }
    } catch (err) {
      // Correction API failed -- local state is already updated, will sync on next load
      console.debug('[dealStore] Correction sync failed:', err instanceof Error ? err.message : err)
    }
  }, 1500)
}

/** Map camelCase DealNumbers field to snake_case backend field. */
const NUMBER_FIELD_MAP: Record<string, string> = {
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
const VEHICLE_FIELD_MAP: Record<string, string> = {
  year: 'year',
  make: 'make',
  model: 'model',
  trim: 'trim',
  vin: 'vin',
  mileage: 'mileage',
  color: 'color',
  engine: 'engine',
}

/** Pure function: apply a single tool call to deal state. No side effects. */
function applyToolCallToState(dealState: DealState, toolCall: ToolCall): DealState {
  switch (toolCall.name) {
    case 'set_vehicle': {
      const args = snakeToCamel(toolCall.args)
      const vehicleId = (args.vehicleId ?? args.id ?? generateId()) as string
      const role = args.role as VehicleRole
      const newVehicle: Vehicle = {
        id: vehicleId,
        role,
        year: args.year,
        make: args.make,
        model: args.model,
        trim: args.trim,
        vin: args.vin,
        mileage: args.mileage,
        color: args.color,
        engine: args.engine,
      }

      let vehicles = [...dealState.vehicles]
      const existingIdx = vehicles.findIndex((v) => v.id === vehicleId)
      if (existingIdx >= 0) {
        // Update existing -- merge non-undefined fields
        vehicles[existingIdx] = {
          ...vehicles[existingIdx],
          ...Object.fromEntries(Object.entries(newVehicle).filter(([_, v]) => v !== undefined)),
        }
      } else {
        // If trade_in and one exists, replace
        if (role === 'trade_in') {
          vehicles = vehicles.filter((v) => v.role !== 'trade_in')
        }
        vehicles.push(newVehicle)
      }

      return { ...dealState, vehicles }
    }

    case 'create_deal': {
      const args = snakeToCamel(toolCall.args)
      const dealId = (args.dealId ?? generateId()) as string
      const newDeal: Deal = {
        id: dealId,
        vehicleId: args.vehicleId,
        dealerName: args.dealerName ?? null,
        phase: 'research',
        numbers: { ...EMPTY_DEAL_NUMBERS },
        scorecard: { ...EMPTY_SCORECARD },
        health: null,
        redFlags: [],
        informationGaps: [],
        firstOffer: null,
        preFiPrice: null,
        savingsEstimate: null,
      }
      return {
        ...dealState,
        deals: [...dealState.deals, newDeal],
        activeDealId: dealId,
      }
    }

    case 'update_deal_numbers': {
      const args = snakeToCamel(toolCall.args)
      const dealId = (args.dealId ?? dealState.activeDealId) as string | null
      if (!dealId) return dealState
      const deals = dealState.deals.map((d) => {
        if (d.id !== dealId) return d
        const numbers = { ...d.numbers }
        for (const [key, value] of Object.entries(args)) {
          if (key === 'dealId') continue
          if (key in numbers) {
            ;(numbers as any)[key] = value
          }
        }
        let firstOffer = d.firstOffer
        if (numbers.currentOffer !== null && firstOffer === null) {
          firstOffer = numbers.currentOffer
        }
        return { ...d, numbers, firstOffer }
      })
      return { ...dealState, deals }
    }

    case 'update_deal_phase': {
      const args = snakeToCamel(toolCall.args)
      const dealId = (args.dealId ?? dealState.activeDealId) as string | null
      if (!dealId) return dealState
      const deals = dealState.deals.map((d) => {
        if (d.id !== dealId) return d
        const phase = args.phase as DealPhase
        let preFiPrice = d.preFiPrice
        if (phase === 'financing' && preFiPrice === null && d.numbers.currentOffer !== null) {
          preFiPrice = d.numbers.currentOffer
        }
        return { ...d, phase, preFiPrice }
      })
      return { ...dealState, deals }
    }

    case 'update_scorecard': {
      const args = snakeToCamel(toolCall.args)
      const dealId = (args.dealId ?? dealState.activeDealId) as string | null
      if (!dealId) return dealState
      const deals = dealState.deals.map((d) => {
        if (d.id !== dealId) return d
        const updates: Partial<Scorecard> = {}
        if (args.scorePrice !== undefined) updates.price = args.scorePrice
        if (args.scoreFinancing !== undefined) updates.financing = args.scoreFinancing
        if (args.scoreTradeIn !== undefined) updates.tradeIn = args.scoreTradeIn
        if (args.scoreFees !== undefined) updates.fees = args.scoreFees
        if (args.scoreOverall !== undefined) updates.overall = args.scoreOverall
        return { ...d, scorecard: { ...d.scorecard, ...updates } }
      })
      return { ...dealState, deals }
    }

    case 'update_deal_health': {
      const args = snakeToCamel(toolCall.args)
      const dealId = (args.dealId ?? dealState.activeDealId) as string | null
      if (!dealId) return dealState
      const health: DealHealth = {
        status: args.status,
        summary: args.summary,
        recommendation: args.recommendation ?? null,
      }
      const deals = dealState.deals.map((d) => {
        if (d.id !== dealId) return d
        return { ...d, health }
      })
      return { ...dealState, deals }
    }

    case 'update_deal_red_flags': {
      const args = snakeToCamel(toolCall.args)
      const dealId = (args.dealId ?? dealState.activeDealId) as string | null
      if (!dealId) return dealState
      const rawFlags = args.flags ?? []
      const flags = (Array.isArray(rawFlags) ? rawFlags : (rawFlags.flags ?? [])) as RedFlag[]
      const deals = dealState.deals.map((d) => {
        if (d.id !== dealId) return d
        return { ...d, redFlags: flags }
      })
      return { ...dealState, deals }
    }

    case 'update_session_red_flags': {
      const rawFlags = toolCall.args.flags ?? []
      const flags = (Array.isArray(rawFlags) ? rawFlags : (rawFlags.flags ?? [])) as RedFlag[]
      return { ...dealState, redFlags: flags }
    }

    case 'update_deal_information_gaps': {
      const args = snakeToCamel(toolCall.args)
      const dealId = (args.dealId ?? dealState.activeDealId) as string | null
      if (!dealId) return dealState
      const rawGaps = args.gaps ?? []
      const gaps = (Array.isArray(rawGaps) ? rawGaps : (rawGaps.gaps ?? [])) as InformationGap[]
      const deals = dealState.deals.map((d) => {
        if (d.id !== dealId) return d
        return { ...d, informationGaps: gaps }
      })
      return { ...dealState, deals }
    }

    case 'update_session_information_gaps': {
      const rawGaps = toolCall.args.gaps ?? []
      const gaps = (Array.isArray(rawGaps) ? rawGaps : (rawGaps.gaps ?? [])) as InformationGap[]
      return { ...dealState, informationGaps: gaps }
    }

    case 'switch_active_deal': {
      const args = snakeToCamel(toolCall.args)
      return { ...dealState, activeDealId: args.dealId as string }
    }

    case 'remove_vehicle': {
      const args = snakeToCamel(toolCall.args)
      const vehicleId = args.vehicleId as string
      const vehicles = dealState.vehicles.filter((v) => v.id !== vehicleId)
      const deals = dealState.deals.filter((d) => d.vehicleId !== vehicleId)
      let activeDealId = dealState.activeDealId
      if (activeDealId && !deals.some((d) => d.id === activeDealId)) {
        activeDealId = deals.length > 0 ? deals[0].id : null
      }
      return { ...dealState, vehicles, deals, activeDealId }
    }

    case 'update_deal_comparison': {
      const args = snakeToCamel(toolCall.args) as DealComparison
      return { ...dealState, dealComparison: args }
    }

    case 'update_insights_panel': {
      const args = snakeToCamel(toolCall.args)
      const cards = (args.cards ?? []) as AiPanelCard[]
      return { ...dealState, aiPanelCards: cards }
    }

    case 'update_negotiation_context': {
      const context = snakeToCamel(toolCall.args) as NegotiationContext
      return { ...dealState, negotiationContext: context }
    }

    case 'update_checklist': {
      const items = toolCall.args.items as ChecklistItem[]
      return { ...dealState, checklist: items }
    }

    case 'update_buyer_context': {
      const camelArgs = snakeToCamel(toolCall.args)
      return {
        ...dealState,
        buyerContext: camelArgs.buyerContext as BuyerContext,
      }
    }

    case 'update_quick_actions': {
      // Ephemeral -- handled by chat store
      return dealState
    }

    default:
      return dealState
  }
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
    } catch (err) {
      console.debug('[dealStore] loadDealState failed:', err instanceof Error ? err.message : err)
      set({ isLoading: false })
    }
  },

  resetDealState: (sessionId, buyerContext) => {
    set({
      dealState: {
        sessionId,
        buyerContext: buyerContext ?? 'researching',
        activeDealId: null,
        vehicles: [],
        deals: [],
        redFlags: [],
        informationGaps: [],
        checklist: [],
        timerStartedAt: null,
        aiPanelCards: [],
        dealComparison: null,
        negotiationContext: null,
      },
      dismissedFlagIds: new Set(),
    })
  },

  applyToolCall: (toolCall) => {
    const { dealState } = get()
    if (!dealState) {
      console.debug('[dealStore] applyToolCall skipped — no dealState:', toolCall.name)
      return
    }
    console.debug('[dealStore] applyToolCall:', toolCall.name)
    const updated = applyToolCallToState(dealState, toolCall)
    if (updated !== dealState) {
      set({ dealState: updated })
    }
  },

  applyToolCalls: (toolCalls) => {
    let { dealState } = get()
    if (!dealState) return
    console.debug('[dealStore] applyToolCalls: batch of', toolCalls.length)
    for (const toolCall of toolCalls) {
      dealState = applyToolCallToState(dealState, toolCall)
    }
    set({ dealState })
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

  correctNumber: (dealId, field, value) => {
    const { dealState } = get()
    if (!dealState) return

    // Update locally immediately
    const deals = dealState.deals.map((d) => {
      if (d.id !== dealId) return d
      return { ...d, numbers: { ...d.numbers, [field]: value } }
    })
    set({ dealState: { ...dealState, deals } })

    // Queue for debounced backend call
    const backendField = NUMBER_FIELD_MAP[field as string]
    if (backendField) {
      const existing = pendingDealCorrections.get(dealId) ?? {}
      existing[backendField] = value
      pendingDealCorrections.set(dealId, existing)
      debouncedSendCorrections(dealState.sessionId, set, get)
    }
  },

  correctVehicleField: (vehicleId, field, value) => {
    const { dealState } = get()
    if (!dealState) return

    // Update locally immediately
    const vehicles = dealState.vehicles.map((v) => {
      if (v.id !== vehicleId) return v
      return { ...v, [field]: value }
    })
    set({ dealState: { ...dealState, vehicles } })

    // Queue for debounced backend call
    const backendField = VEHICLE_FIELD_MAP[field as string]
    if (backendField) {
      const existing = pendingVehicleCorrections.get(vehicleId) ?? {}
      existing[backendField] = value as string | number | null
      pendingVehicleCorrections.set(vehicleId, existing)
      debouncedSendCorrections(dealState.sessionId, set, get)
    }
  },
}))
