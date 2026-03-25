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

export interface Vehicle {
  year: number
  make: string
  model: string
  trim?: string
  vin?: string
  mileage?: number
  color?: string
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

// ─── Deal State (persistent UI) ───

export interface DealState {
  sessionId: string
  phase: DealPhase
  buyerContext: BuyerContext
  numbers: DealNumbers
  vehicle: Vehicle | null
  scorecard: Scorecard
  checklist: ChecklistItem[]
  timerStartedAt: string | null
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
    | 'update_checklist'
    | 'update_buyer_context'
    | 'update_quick_actions'
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
  sendMessage(sessionId: string, content: string, imageUri?: string): Promise<Message>

  // Deal state
  getDealState(sessionId: string): Promise<DealState>

  // Simulations
  getScenarios(): Promise<Scenario[]>
  startSimulation(scenarioId: string): Promise<Session>
}
