import type {
  ApiService,
  BuyerContext,
  Session,
  Message,
  DealState,
  RedFlag,
  Scenario,
  ToolCall,
  MessageUsage,
  ModelUsageSummary,
  SessionUsage,
} from './types'
import { DEFAULT_BUYER_CONTEXT } from './constants'
import { snakeToCamel } from './utils'

const API_BASE = 'http://localhost:8001/api'

let authToken: string | null = null

export function setAuthToken(token: string | null) {
  authToken = token
}

function headers(json = true): Record<string, string> {
  const h: Record<string, string> = {}
  if (json) h['Content-Type'] = 'application/json'
  if (authToken) h['Authorization'] = `Bearer ${authToken}`
  return h
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${res.status}: ${text}`)
  }
  return res.json()
}

function mapDealSummary(ds: any): import('./types').DealSummary | null {
  if (!ds) return null
  return {
    phase: ds.phase ?? null,
    vehicleYear: ds.vehicle_year ?? null,
    vehicleMake: ds.vehicle_make ?? null,
    vehicleModel: ds.vehicle_model ?? null,
    vehicleTrim: ds.vehicle_trim ?? null,
    currentOffer: ds.current_offer ?? null,
    listingPrice: ds.listing_price ?? null,
    scoreOverall: ds.score_overall ?? null,
    dealCount: ds.deal_count ?? 0,
  }
}

function mapSession(s: any): Session {
  return {
    id: s.id,
    title: s.title,
    sessionType: s.session_type,
    linkedSessionIds: s.linked_session_ids || [],
    lastMessagePreview: s.last_message_preview || '',
    usage: s.usage ? mapSessionUsage(s.usage) : undefined,
    dealSummary: mapDealSummary(s.deal_summary),
    updatedAt: s.updated_at,
    createdAt: s.created_at,
  }
}

function mapUsageSummary(value: any): ModelUsageSummary {
  return {
    requestCount: value.requestCount ?? 0,
    inputTokens: value.inputTokens ?? 0,
    outputTokens: value.outputTokens ?? 0,
    cacheCreationInputTokens: value.cacheCreationInputTokens ?? 0,
    cacheReadInputTokens: value.cacheReadInputTokens ?? 0,
    totalTokens: value.totalTokens ?? 0,
    totalCostUsd: value.totalCostUsd ?? 0,
  }
}

function mapSessionUsage(value: any): SessionUsage {
  const perModel = Object.fromEntries(
    Object.entries(value.perModel ?? {}).map(([model, summary]: [string, any]) => [
      model,
      mapUsageSummary(summary),
    ])
  )

  return {
    ...mapUsageSummary(value),
    perModel,
  }
}

/** Map a single vehicle from backend snake_case to frontend Vehicle type. */
function mapVehicle(v: any): import('./types').Vehicle {
  return {
    id: v.id,
    role: v.role,
    year: v.year,
    make: v.make,
    model: v.model,
    trim: v.trim ?? undefined,
    vin: v.vin ?? undefined,
    mileage: v.mileage ?? undefined,
    color: v.color ?? undefined,
    engine: v.engine ?? undefined,
    identityConfirmationStatus: v.identity_confirmation_status ?? 'unconfirmed',
    identityConfirmedAt: v.identity_confirmed_at ?? null,
    identityConfirmationSource: v.identity_confirmation_source ?? null,
    intelligence: v.intelligence ? mapVehicleIntelligence(v.intelligence) : null,
  }
}

function mapVehicleDecode(value: any): import('./types').VehicleDecode | null {
  if (!value) return null
  return {
    id: value.id,
    provider: value.provider,
    status: value.status,
    vin: value.vin,
    year: value.year ?? undefined,
    make: value.make ?? undefined,
    model: value.model ?? undefined,
    trim: value.trim ?? undefined,
    engine: value.engine ?? undefined,
    bodyType: value.body_type ?? undefined,
    drivetrain: value.drivetrain ?? undefined,
    transmission: value.transmission ?? undefined,
    fuelType: value.fuel_type ?? undefined,
    sourceSummary: value.source_summary ?? undefined,
    rawPayload: value.raw_payload ?? undefined,
    requestedAt: value.requested_at,
    fetchedAt: value.fetched_at ?? null,
    expiresAt: value.expires_at ?? null,
  }
}

function mapVehicleHistoryReport(value: any): import('./types').VehicleHistoryReport | null {
  if (!value) return null
  return {
    id: value.id,
    provider: value.provider,
    status: value.status,
    vin: value.vin,
    titleBrands: value.title_brands ?? [],
    titleBrandCount: value.title_brand_count ?? 0,
    hasSalvage: value.has_salvage ?? false,
    hasTotalLoss: value.has_total_loss ?? false,
    hasTheftRecord: value.has_theft_record ?? false,
    hasOdometerIssue: value.has_odometer_issue ?? false,
    sourceSummary: value.source_summary ?? undefined,
    coverageNotes: value.coverage_notes ?? undefined,
    requestedAt: value.requested_at,
    fetchedAt: value.fetched_at ?? null,
    expiresAt: value.expires_at ?? null,
  }
}

function mapVehicleValuation(value: any): import('./types').VehicleValuation | null {
  if (!value) return null
  return {
    id: value.id,
    provider: value.provider,
    status: value.status,
    vin: value.vin,
    amount: value.amount ?? null,
    currency: value.currency ?? 'USD',
    valuationLabel: value.valuation_label ?? 'Market Asking Price Estimate',
    sourceSummary: value.source_summary ?? undefined,
    requestedAt: value.requested_at,
    fetchedAt: value.fetched_at ?? null,
    expiresAt: value.expires_at ?? null,
  }
}

function mapVehicleIntelligence(value: any): import('./types').VehicleIntelligence {
  return {
    decode: mapVehicleDecode(value.decode),
    historyReport: mapVehicleHistoryReport(value.history_report),
    valuation: mapVehicleValuation(value.valuation),
    loadingAction: null,
    error: null,
  }
}

/** Map a single deal from backend flat fields to frontend Deal type. */
function mapDeal(d: any): import('./types').Deal {
  return {
    id: d.id,
    vehicleId: d.vehicle_id,
    dealerName: d.dealer_name ?? null,
    phase: d.phase,
    numbers: {
      msrp: d.msrp,
      invoicePrice: d.invoice_price,
      listingPrice: d.listing_price,
      yourTarget: d.your_target,
      walkAwayPrice: d.walk_away_price,
      currentOffer: d.current_offer,
      monthlyPayment: d.monthly_payment,
      apr: d.apr,
      loanTermMonths: d.loan_term_months,
      downPayment: d.down_payment,
      tradeInValue: d.trade_in_value,
    },
    scorecard: {
      price: d.score_price,
      financing: d.score_financing,
      tradeIn: d.score_trade_in,
      fees: d.score_fees,
      overall: d.score_overall,
    },
    health: d.health_status
      ? {
          status: d.health_status,
          summary: d.health_summary ?? '',
          recommendation: d.recommendation ?? null,
        }
      : null,
    redFlags: (d.red_flags ?? []).map((f: any) => ({
      id: f.id,
      severity: f.severity,
      message: f.message,
    })),
    informationGaps: (d.information_gaps ?? []).map((g: any) => ({
      label: g.label,
      reason: g.reason,
      priority: g.priority,
    })),
    firstOffer: d.first_offer ?? null,
    preFiPrice: d.pre_fi_price ?? null,
    savingsEstimate: d.savings_estimate ?? null,
  }
}

/** Map an AI panel card from backend snake_case to frontend AiPanelCard type. */
function mapAiPanelCard(c: any): import('./types').AiPanelCard {
  return {
    type: c.type,
    title: c.title,
    content: c.content ?? {},
    priority: c.priority,
  }
}

/** Map a deal comparison from backend to frontend DealComparison type. */
function mapDealComparison(dc: any): import('./types').DealComparison | null {
  if (!dc) return null
  return {
    summary: dc.summary,
    recommendation: dc.recommendation,
    bestDealId: dc.best_deal_id,
    highlights: (dc.highlights ?? []).map((h: any) => ({
      label: h.label,
      values: (h.values ?? []).map((v: any) => ({
        dealId: v.deal_id,
        value: v.value,
        isWinner: v.is_winner,
      })),
      note: h.note ?? undefined,
    })),
  }
}

/** Map camelCase vehicle field names to snake_case for the backend. */
const VEHICLE_FIELD_MAP: Record<string, string> = {
  vehicleId: 'vehicle_id',
  year: 'year',
  make: 'make',
  model: 'model',
  trim: 'trim',
  vin: 'vin',
  mileage: 'mileage',
  color: 'color',
  engine: 'engine',
  role: 'role',
}

/** Map camelCase deal field names to snake_case for the backend. */
const DEAL_FIELD_MAP: Record<string, string> = {
  dealId: 'deal_id',
  vehicleId: 'vehicle_id',
  dealerName: 'dealer_name',
  phase: 'phase',
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

/** Convert a corrections object from camelCase keys to snake_case. */
function toSnakeCase(
  obj: Record<string, any>,
  fieldMap: Record<string, string>
): Record<string, any> {
  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = fieldMap[key] ?? key
    result[snakeKey] = value
  }
  return result
}

class ApiClient implements ApiService {
  // ─── Auth ───

  async login(email: string, password: string) {
    const data = await request<{ access_token: string; user_id: string; role: string }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password }) }
    )
    setAuthToken(data.access_token)
    return { userId: data.user_id, role: data.role }
  }

  async register(email: string, password: string, role: string) {
    const data = await request<{ access_token: string; user_id: string; role: string }>(
      '/auth/signup',
      { method: 'POST', body: JSON.stringify({ email, password, role }) }
    )
    setAuthToken(data.access_token)
    return { userId: data.user_id }
  }

  // ─── Sessions ───

  async getSessions(): Promise<Session[]> {
    const sessions = await request<any[]>('/sessions')
    return sessions.map(mapSession)
  }

  async searchSessions(query: string): Promise<Session[]> {
    const sessions = await request<any[]>(`/sessions?q=${encodeURIComponent(query)}`)
    return sessions.map(mapSession)
  }

  async createSession(
    type: 'buyer_chat' | 'dealer_sim',
    title?: string,
    buyerContext?: BuyerContext
  ): Promise<Session> {
    const body: Record<string, string | undefined> = { session_type: type, title }
    if (buyerContext) body.buyer_context = buyerContext
    const s = await request<any>('/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return mapSession(s)
  }

  async linkSessions(sessionId: string, linkedIds: string[]): Promise<void> {
    await request(`/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ linked_session_ids: linkedIds }),
    })
  }

  async deleteSession(sessionId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: headers(false),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`API ${res.status}: ${text}`)
    }
  }

  // ─── Chat ───

  async getMessages(sessionId: string): Promise<Message[]> {
    const msgs = await request<any[]>(`/chat/${sessionId}/messages`)
    return msgs.map((m) => ({
      id: m.id,
      sessionId: m.session_id,
      role: m.role,
      content: m.content,
      imageUri: m.image_url,
      toolCalls: m.tool_calls?.map((tc: any) => ({
        name: tc.name as ToolCall['name'],
        args: tc.args,
      })),
      usage: m.usage,
      createdAt: m.created_at,
    }))
  }

  sendMessage(
    sessionId: string,
    content: string,
    imageUri?: string,
    onChunk?: (text: string) => void,
    onToolResult?: (toolCall: ToolCall) => void,
    onTextDone?: (finalText: string, usage?: MessageUsage, sessionUsage?: SessionUsage) => void,
    onRetry?: (data: { attempt: number; reason: string }) => void,
    onStep?: (data: { step: number }) => void
  ): Promise<Message> {
    // Use XMLHttpRequest for true incremental streaming — fetch's ReadableStream
    // is buffered by React Native's polyfill and doesn't deliver chunks live.
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${API_BASE}/chat/${sessionId}/message`)
      xhr.setRequestHeader('Content-Type', 'application/json')
      if (authToken) xhr.setRequestHeader('Authorization', `Bearer ${authToken}`)

      xhr.timeout = 150000 // 150s — slightly above backend's 120s API timeout

      let fullText = ''
      let messageUsage: MessageUsage | undefined
      let sessionUsage: SessionUsage | undefined
      const toolCalls: ToolCall[] = []
      let processed = 0
      let buffer = ''
      let sseError: string | null = null

      xhr.onprogress = () => {
        const newData = xhr.responseText.slice(processed)
        processed = xhr.responseText.length
        buffer += newData

        // SSE messages are delimited by double newlines
        const messages = buffer.split('\n\n')
        // Last element may be incomplete — keep it in the buffer
        buffer = messages.pop() ?? ''

        for (const message of messages) {
          if (!message.trim()) continue
          let eventType = ''
          let dataStr = ''

          for (const line of message.split('\n')) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim()
            } else if (line.startsWith('data: ')) {
              dataStr = line.slice(6)
            }
          }

          if (!eventType || !dataStr) continue

          try {
            const data = JSON.parse(dataStr)
            if (eventType === 'text' && data.chunk) {
              fullText += data.chunk
              onChunk?.(fullText)
            } else if (eventType === 'done') {
              // Text streaming is complete — finalize immediately
              // (don't wait for onload which blocks on Stages 2+3)
              fullText = data.text ?? fullText
              messageUsage = data.usage
              sessionUsage = data.sessionUsage ? mapSessionUsage(data.sessionUsage) : undefined
              onTextDone?.(fullText, messageUsage, sessionUsage)
            } else if (eventType === 'error') {
              console.error('[apiClient] SSE error event:', data.message ?? data)
              sseError = data.message ?? 'An error occurred'
            } else if (eventType === 'retry') {
              if (data.reset_text) {
                fullText = ''
                onChunk?.('')
              }
              onRetry?.(data)
            } else if (eventType === 'step') {
              onStep?.(data)
            } else if (eventType === 'tool_error') {
              console.warn('[apiClient] Tool execution error:', data.tool, data.error)
            } else if (eventType === 'tool_result' && data.tool) {
              const toolCall: ToolCall = { name: data.tool as ToolCall['name'], args: data.data }
              toolCalls.push(toolCall)
              // Process tool results incrementally as they arrive
              onToolResult?.(toolCall)
            }
          } catch (e) {
            console.debug('[apiClient] Skipping malformed SSE data:', dataStr, e)
          }
        }
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          // Process any remaining data not caught by onprogress
          xhr.onprogress?.(null as any)
          if (sseError) {
            reject(new Error(sseError))
            return
          }
          resolve({
            id: Math.random().toString(36).substring(2),
            sessionId,
            role: 'assistant',
            content: fullText,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            usage: messageUsage,
            createdAt: new Date().toISOString(),
          })
        } else {
          reject(new Error(`Chat API ${xhr.status}`))
        }
      }

      xhr.onerror = () => reject(new Error('Network error'))
      xhr.ontimeout = () => reject(new Error('Request timed out'))
      xhr.send(JSON.stringify({ content, image_url: imageUri }))
    })
  }

  // ─── Deal State ───

  async getDealState(sessionId: string): Promise<DealState> {
    const ds = await request<any>(`/deal/${sessionId}`)
    return {
      sessionId: ds.session_id,
      buyerContext: ds.buyer_context || DEFAULT_BUYER_CONTEXT,
      activeDealId: ds.active_deal_id ?? null,
      vehicles: (ds.vehicles ?? []).map(mapVehicle),
      deals: (ds.deals ?? []).map(mapDeal),
      redFlags: (ds.red_flags ?? []).map((f: any) => ({
        id: f.id,
        severity: f.severity,
        message: f.message,
      })),
      informationGaps: (ds.information_gaps ?? []).map((g: any) => ({
        label: g.label,
        reason: g.reason,
        priority: g.priority,
      })),
      checklist: ds.checklist || [],
      timerStartedAt: ds.timer_started_at ?? null,
      aiPanelCards: (ds.ai_panel_cards ?? []).map(mapAiPanelCard),
      dealComparison: mapDealComparison(ds.deal_comparison),
      negotiationContext: ds.negotiation_context
        ? (snakeToCamel(ds.negotiation_context) as DealState['negotiationContext'])
        : null,
    }
  }

  async correctDealState(
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
  }> {
    const payload: Record<string, any> = {}

    if (corrections.vehicleCorrections) {
      payload.vehicle_corrections = corrections.vehicleCorrections.map((vc) =>
        toSnakeCase(vc, VEHICLE_FIELD_MAP)
      )
    }

    if (corrections.dealCorrections) {
      payload.deal_corrections = corrections.dealCorrections.map((dc) =>
        toSnakeCase(dc, DEAL_FIELD_MAP)
      )
    }

    const res = await request<any>(`/deal/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
    return {
      dealId: res.deal_id ?? '',
      healthStatus: res.health_status ?? null,
      healthSummary: res.health_summary ?? null,
      recommendation: res.recommendation ?? null,
      redFlags: (res.red_flags ?? []).map((f: any) => ({
        id: f.id,
        severity: f.severity,
        message: f.message,
      })),
    }
  }

  async getVehicleIntelligence(sessionId: string, vehicleId: string) {
    const res = await request<any>(`/deal/${sessionId}/vehicles/${vehicleId}/intelligence`)
    return mapVehicleIntelligence(res)
  }

  async decodeVehicleVin(sessionId: string, vehicleId: string, vin?: string) {
    const res = await request<any>(`/deal/${sessionId}/vehicles/${vehicleId}/decode-vin`, {
      method: 'POST',
      body: JSON.stringify(vin ? { vin } : {}),
    })
    return mapVehicleIntelligence(res)
  }

  async upsertVehicleFromVin(sessionId: string, vin: string) {
    const res = await request<any>(`/deal/${sessionId}/vehicles/upsert-from-vin`, {
      method: 'POST',
      body: JSON.stringify({ vin }),
    })
    return mapVehicle(res)
  }

  async confirmVehicleIdentity(
    sessionId: string,
    vehicleId: string,
    status: 'confirmed' | 'rejected'
  ) {
    const res = await request<any>(`/deal/${sessionId}/vehicles/${vehicleId}/confirm-identity`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    })
    return mapVehicle(res)
  }

  async checkVehicleHistory(sessionId: string, vehicleId: string, vin?: string) {
    const res = await request<any>(`/deal/${sessionId}/vehicles/${vehicleId}/check-history`, {
      method: 'POST',
      body: JSON.stringify(vin ? { vin } : {}),
    })
    return mapVehicleIntelligence(res)
  }

  async getVehicleValuation(sessionId: string, vehicleId: string, vin?: string) {
    const res = await request<any>(`/deal/${sessionId}/vehicles/${vehicleId}/get-valuation`, {
      method: 'POST',
      body: JSON.stringify(vin ? { vin } : {}),
    })
    return mapVehicleIntelligence(res)
  }

  // ─── Simulations ───

  async getScenarios(): Promise<Scenario[]> {
    const scenarios = await request<any[]>('/simulations/scenarios')
    return scenarios.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      difficulty: s.difficulty,
      aiPersona: s.ai_persona,
    }))
  }

  async startSimulation(_scenarioId: string): Promise<Session> {
    return this.createSession('dealer_sim', 'Simulation')
  }
}

export { ApiClient }
