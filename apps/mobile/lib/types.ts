// ─── Buyer Context ───

export type BuyerContext = 'researching' | 'reviewing_deal' | 'at_dealership'

// ─── Deal Phases ───

export type DealPhase =
  | 'research'
  | 'initial_contact'
  | 'test_drive'
  | 'negotiation'
  | 'financing'
  | 'closing'

export type ScoreStatus = 'red' | 'yellow' | 'green' | null

// ─── Vehicle ───

export type VehicleRole = 'primary' | 'trade_in'

export interface Vehicle {
  id: string
  role: VehicleRole
  year: number
  make: string
  model: string
  trim?: string
  vin?: string
  mileage?: number
  color?: string
  engine?: string
}

// ─── Deal Numbers ───

export interface DealNumbers {
  msrp: number | null
  invoicePrice: number | null
  listingPrice: number | null
  yourTarget: number | null
  walkAwayPrice: number | null
  currentOffer: number | null
  monthlyPayment: number | null
  apr: number | null
  loanTermMonths: number | null
  downPayment: number | null
  tradeInValue: number | null
}

// ─── Scorecard ───

export interface Scorecard {
  price: ScoreStatus
  financing: ScoreStatus
  tradeIn: ScoreStatus
  fees: ScoreStatus
  overall: ScoreStatus
}

// ─── Checklist ───

export interface ChecklistItem {
  label: string
  done: boolean
}

// ─── Deal Health ───

export type HealthStatus = 'good' | 'fair' | 'concerning' | 'bad'

export interface DealHealth {
  status: HealthStatus
  summary: string
  recommendation: string | null
}

// ─── Red Flags ───

export type RedFlagSeverity = 'warning' | 'critical'

export interface RedFlag {
  id: string
  severity: RedFlagSeverity
  message: string
}

// ─── Information Gaps ───

export type GapPriority = 'high' | 'medium' | 'low'

export interface InformationGap {
  label: string
  reason: string
  priority: GapPriority
}

// ─── Deal ───

export interface Deal {
  id: string
  vehicleId: string
  dealerName: string | null
  phase: DealPhase
  numbers: DealNumbers
  scorecard: Scorecard
  health: DealHealth | null
  redFlags: RedFlag[]
  informationGaps: InformationGap[]
  firstOffer: number | null
  preFiPrice: number | null
  savingsEstimate: number | null
}

// ─── Deal Comparison ───

export interface ComparisonHighlight {
  label: string
  values: { dealId: string; value: string; isWinner: boolean }[]
  note?: string
}

export interface DealComparison {
  summary: string
  recommendation: string
  bestDealId: string
  highlights: ComparisonHighlight[]
}

// ─── AI Panel ───

export type AiCardType =
  | 'briefing'
  | 'numbers'
  | 'comparison'
  | 'vehicle'
  | 'warning'
  | 'tip'
  | 'checklist'
  | 'success'
export type AiCardPriority = 'critical' | 'high' | 'normal' | 'low'

export interface AiPanelCard {
  type: AiCardType
  title: string
  content: Record<string, any>
  priority: AiCardPriority
}

// ─── Deal State (session-level + deals + vehicles) ───

export interface DealState {
  sessionId: string
  buyerContext: BuyerContext
  activeDealId: string | null
  vehicles: Vehicle[]
  deals: Deal[]
  // Session-level
  redFlags: RedFlag[]
  informationGaps: InformationGap[]
  checklist: ChecklistItem[]
  timerStartedAt: string | null
  aiPanelCards: AiPanelCard[]
  dealComparison: DealComparison | null
}

// ─── Quick Actions ───

export interface QuickAction {
  label: string
  prompt: string
}

// ─── Messages ───

export interface ToolCall {
  name:
    | 'update_deal_numbers'
    | 'update_deal_phase'
    | 'update_scorecard'
    | 'set_vehicle'
    | 'create_deal'
    | 'switch_active_deal'
    | 'remove_vehicle'
    | 'update_checklist'
    | 'update_buyer_context'
    | 'update_quick_actions'
    | 'update_deal_health'
    | 'update_deal_red_flags'
    | 'update_session_red_flags'
    | 'update_deal_information_gaps'
    | 'update_session_information_gaps'
    | 'update_deal_comparison'
    | 'update_insights_panel'
  args: Record<string, any>
}

export interface Message {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  imageUri?: string
  toolCalls?: ToolCall[]
  createdAt: string
}

// ─── Deal Summary (lightweight, for session cards) ───

export interface DealSummary {
  phase: DealPhase | null
  vehicleYear: number | null
  vehicleMake: string | null
  vehicleModel: string | null
  vehicleTrim: string | null
  currentOffer: number | null
  listingPrice: number | null
  scoreOverall: ScoreStatus | null
  dealCount: number
}

// ─── Sessions ───

export interface Session {
  id: string
  title: string
  sessionType: 'buyer_chat' | 'dealer_sim'
  linkedSessionIds: string[]
  lastMessagePreview: string
  dealSummary: DealSummary | null
  updatedAt: string
  createdAt: string
}

// ─── Dealer Simulations ───

export interface AiPersona {
  name: string
  budget: number
  personality: string
  vehicle: string
  challenges: string[]
}

export interface Scenario {
  id: string
  title: string
  description: string
  difficulty: 'easy' | 'medium' | 'hard'
  aiPersona: AiPersona
}

// ─── API Service Interface ───

export interface ApiService {
  // Auth
  login(email: string, password: string): Promise<{ userId: string; role: string }>
  register(email: string, password: string, role: string): Promise<{ userId: string }>

  // Sessions
  getSessions(): Promise<Session[]>
  searchSessions(query: string): Promise<Session[]>
  createSession(
    type: 'buyer_chat' | 'dealer_sim',
    title?: string,
    buyerContext?: BuyerContext
  ): Promise<Session>
  linkSessions(sessionId: string, linkedIds: string[]): Promise<void>
  deleteSession(sessionId: string): Promise<void>

  // Chat
  getMessages(sessionId: string): Promise<Message[]>
  sendMessage(
    sessionId: string,
    content: string,
    imageUri?: string,
    onChunk?: (text: string) => void,
    onToolResult?: (toolCall: ToolCall) => void,
    onTextDone?: (finalText: string) => void
  ): Promise<Message>

  // Deal state
  getDealState(sessionId: string): Promise<DealState>
  correctDealState(
    sessionId: string,
    corrections: {
      vehicleCorrections?: {
        vehicleId: string
        [field: string]: string | number | null | undefined
      }[]
      dealCorrections?: { dealId: string; [field: string]: string | number | null | undefined }[]
    }
  ): Promise<{
    dealId: string
    healthStatus: string | null
    healthSummary: string | null
    recommendation: string | null
    redFlags: RedFlag[]
  }>

  // Simulations
  getScenarios(): Promise<Scenario[]>
  startSimulation(scenarioId: string): Promise<Session>
}
