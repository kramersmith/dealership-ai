// ─── Buyer Context ───

export type BuyerContext = 'researching' | 'reviewing_deal' | 'at_dealership'

export type InsightsUpdateMode = 'live' | 'paused'

export interface UserSettings {
  insightsUpdateMode: InsightsUpdateMode
}

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

export type VehicleRole = 'primary' | 'candidate' | 'trade_in'

export type VehicleIntelligenceStatus = 'idle' | 'loading' | 'success' | 'partial' | 'failed'

export interface VehicleDecode {
  id: string
  provider: string
  status: VehicleIntelligenceStatus | string
  vin: string
  year?: number
  make?: string
  model?: string
  trim?: string
  engine?: string
  bodyType?: string
  drivetrain?: string
  transmission?: string
  fuelType?: string
  sourceSummary?: string
  rawPayload?: Record<string, any>
  requestedAt: string
  fetchedAt?: string | null
  expiresAt?: string | null
}

export interface VehicleHistoryReport {
  id: string
  provider: string
  status: VehicleIntelligenceStatus | string
  vin: string
  titleBrands: string[]
  titleBrandCount: number
  hasSalvage: boolean
  hasTotalLoss: boolean
  hasTheftRecord: boolean
  hasOdometerIssue: boolean
  sourceSummary?: string
  coverageNotes?: string
  requestedAt: string
  fetchedAt?: string | null
  expiresAt?: string | null
}

export interface VehicleValuation {
  id: string
  provider: string
  status: VehicleIntelligenceStatus | string
  vin: string
  amount?: number | null
  currency: string
  valuationLabel: string
  sourceSummary?: string
  requestedAt: string
  fetchedAt?: string | null
  expiresAt?: string | null
}

export interface VehicleIntelligence {
  decode: VehicleDecode | null
  historyReport: VehicleHistoryReport | null
  valuation: VehicleValuation | null
  loadingAction?: 'decode' | 'history' | 'valuation' | null
  error?: string | null
}

export interface Vehicle {
  id: string
  role: VehicleRole
  year: number
  make: string
  model: string
  trim?: string
  cabStyle?: string
  bedLength?: string
  vin?: string
  mileage?: number
  color?: string
  engine?: string
  identityConfirmationStatus?: 'unconfirmed' | 'confirmed' | 'rejected'
  identityConfirmedAt?: string | null
  identityConfirmationSource?: string | null
  intelligence?: VehicleIntelligence | null
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

export type AiCardTemplate =
  | 'briefing'
  | 'numbers'
  | 'comparison'
  | 'vehicle'
  | 'warning'
  | 'tip'
  | 'notes'
  | 'checklist'
  | 'success'

export type AiCardKind =
  | 'vehicle'
  | 'numbers'
  | 'phase'
  | 'warning'
  | 'notes'
  | 'comparison'
  | 'checklist'
  | 'success'
  | 'what_changed'
  | 'dealer_read'
  | 'your_leverage'
  | 'next_best_move'
  | 'if_you_say_yes'
  | 'trade_off'
  | 'savings_so_far'

export type AiCardPriority = 'critical' | 'high' | 'normal' | 'low'

export interface AiPanelCard {
  kind: AiCardKind
  template: AiCardTemplate
  title: string
  content: Record<string, any>
  priority: AiCardPriority
}

// ─── Negotiation Context ───

export type NegotiationStance =
  | 'researching'
  | 'preparing'
  | 'engaging'
  | 'negotiating'
  | 'holding'
  | 'walking'
  | 'waiting'
  | 'financing'
  | 'closing'
  | 'post_purchase'

export interface NegotiationKeyNumber {
  label: string
  value: string
  note: string | null
}

export interface NegotiationScript {
  label: string
  text: string
}

export interface NegotiationPendingAction {
  action: string
  detail: string | null
  done: boolean
}

export interface NegotiationContext {
  situation: string
  stance: NegotiationStance
  keyNumbers?: NegotiationKeyNumber[]
  scripts?: NegotiationScript[]
  pendingActions?: NegotiationPendingAction[]
  leverage?: string[]
  updatedAt?: string
}

/** Structured comparison table rendered inline in chat message presentation blocks. */
export interface ComparisonTable {
  title?: string | null
  headers: string[]
  rows: string[][]
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
  negotiationContext: NegotiationContext | null
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
    | 'update_deal_health'
    | 'update_deal_red_flags'
    | 'update_session_red_flags'
    | 'update_deal_information_gaps'
    | 'update_session_information_gaps'
    | 'update_deal_comparison'
    | 'update_insights_panel'
    | 'update_negotiation_context'
  args: Record<string, any>
}

export interface QuotedCard {
  title: string
  kind: AiCardKind
  template: AiCardTemplate
  content: Record<string, any>
}

export interface MessageUsage {
  requests: number
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  totalTokens: number
}

export interface ModelUsageSummary {
  requestCount: number
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  totalTokens: number
  totalCostUsd: number
}

export interface SessionUsage {
  requestCount: number
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  totalTokens: number
  totalCostUsd: number
  perModel: Record<string, ModelUsageSummary>
}

export interface ContextPressure {
  level: 'ok' | 'warn' | 'critical'
  estimatedInputTokens: number
  inputBudget: number
}

export interface Message {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  imageUri?: string
  toolCalls?: ToolCall[]
  /** Canonical insights panel snapshot for this assistant turn (from API / panel_done). */
  panelCards?: AiPanelCard[]
  usage?: MessageUsage
  completionStatus?: 'complete' | 'interrupted' | 'failed'
  interruptedAt?: string | null
  interruptedReason?: string | null
  quotedCard?: QuotedCard
  createdAt: string
  status?: 'queued' | 'sending' | 'failed'
}

export interface VinAssistDecodedVehicle {
  year?: number
  make?: string
  model?: string
  trim?: string
  partial: boolean
}

export interface VinAssistItem {
  id: string
  sessionId: string
  vin: string
  sourceMessageId: string
  status: 'detected' | 'decoding' | 'decoded' | 'confirmed' | 'skipped' | 'failed' | 'rejected'
  decodedVehicle?: VinAssistDecodedVehicle
  vehicleId?: string
  error?: string | null
  updatedAt: string
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
  usage?: SessionUsage
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
  login(
    email: string,
    password: string
  ): Promise<{ userId: string; role: string; settings: UserSettings }>
  register(
    email: string,
    password: string,
    role: string
  ): Promise<{ userId: string; role: string; settings: UserSettings }>
  getUserSettings(): Promise<UserSettings>
  updateUserSettings(patch: Partial<UserSettings>): Promise<UserSettings>

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
  getMessages(sessionId: string): Promise<{ messages: Message[]; contextPressure: ContextPressure }>
  /** Persist user text only (no assistant) — VIN intercept and similar. */
  persistUserMessage(sessionId: string, content: string, imageUri?: string): Promise<Message>
  sendMessage(
    sessionId: string,
    content: string,
    imageUri?: string,
    onChunk?: (text: string) => void,
    onToolResult?: (toolCall: ToolCall) => void,
    onTextDone?: (
      finalText: string,
      usage?: MessageUsage,
      sessionUsage?: SessionUsage,
      assistantMessageId?: string
    ) => void,
    onRetry?: (data: { attempt: number; reason: string }) => void,
    onStep?: (data: { step: number }) => void,
    onPanelStarted?: () => void,
    onPanelFinished?: () => void,
    onCompaction?: (phase: 'started' | 'done' | 'error') => void,
    onTurnStarted?: (data: { turnId: string }) => void,
    onInterrupted?: (data: {
      text: string
      reason: string
      assistantMessageId?: string
      usage?: MessageUsage
    }) => void,
    onPanelInterrupted?: (data: { reason: string }) => void,
    /** Stream updates this persisted user row instead of inserting (resume after VIN intercept). */
    existingUserMessageId?: string,
    onNonFatalError?: (message: string) => void
  ): Promise<Message>
  /** Branch timeline from a user message (truncate tail + optional commerce reset) then stream. */
  branchFromUserMessage(
    sessionId: string,
    anchorUserMessageId: string,
    content: string,
    imageUri?: string,
    onChunk?: (text: string) => void,
    onToolResult?: (toolCall: ToolCall) => void,
    onTextDone?: (
      finalText: string,
      usage?: MessageUsage,
      sessionUsage?: SessionUsage,
      assistantMessageId?: string
    ) => void,
    onRetry?: (data: { attempt: number; reason: string }) => void,
    onStep?: (data: { step: number }) => void,
    onPanelStarted?: () => void,
    onPanelFinished?: () => void,
    onCompaction?: (phase: 'started' | 'done' | 'error') => void,
    onTurnStarted?: (data: { turnId: string }) => void,
    onInterrupted?: (data: {
      text: string
      reason: string
      assistantMessageId?: string
      usage?: MessageUsage
    }) => void,
    onPanelInterrupted?: (data: { reason: string }) => void,
    onNonFatalError?: (message: string) => void
  ): Promise<Message>
  stopGeneration(
    sessionId: string,
    turnId?: string
  ): Promise<{ status: string; turnId?: string; cancelled: boolean }>
  startInsightsFollowup(
    sessionId: string,
    assistantMessageId: string,
    onToolResult?: (toolCall: ToolCall) => void,
    onPanelStarted?: () => void,
    onPanelFinished?: () => void,
    onPanelInterrupted?: (data: { reason: string }) => void,
    onNonFatalError?: (message: string) => void
  ): Promise<void>
  refreshInsightsPanel(
    sessionId: string
  ): Promise<{ cards: AiPanelCard[]; assistantMessageId: string }>
  cancelActiveStream(sessionId: string): boolean

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
  getVehicleIntelligence(sessionId: string, vehicleId: string): Promise<VehicleIntelligence>
  decodeVehicleVin(sessionId: string, vehicleId: string, vin?: string): Promise<VehicleIntelligence>
  upsertVehicleFromVin(sessionId: string, vin: string): Promise<Vehicle>
  confirmVehicleIdentity(
    sessionId: string,
    vehicleId: string,
    status: 'confirmed' | 'rejected'
  ): Promise<Vehicle>
  checkVehicleHistory(
    sessionId: string,
    vehicleId: string,
    vin?: string
  ): Promise<VehicleIntelligence>
  getVehicleValuation(
    sessionId: string,
    vehicleId: string,
    vin?: string
  ): Promise<VehicleIntelligence>

  // Simulations
  getScenarios(): Promise<Scenario[]>
  startSimulation(scenarioId: string): Promise<Session>
}
