import type {
  ApiService,
  BuyerContext,
  ContextPressure,
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
import { PANEL_UPDATE_MODE } from './types'
import { DEFAULT_BUYER_CONTEXT } from './constants'
import { snakeToCamel } from './utils'

const API_BASE = 'http://localhost:8001/api'

let authToken: string | null = null

export function setAuthToken(token: string | null) {
  authToken = token
}

function headers(json = true): Record<string, string> {
  const requestHeaders: Record<string, string> = {}
  if (json) requestHeaders['Content-Type'] = 'application/json'
  if (authToken) requestHeaders['Authorization'] = `Bearer ${authToken}`
  return requestHeaders
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

function mapDealSummary(rawSummary: any): import('./types').DealSummary | null {
  if (!rawSummary) return null
  return {
    phase: rawSummary.phase ?? null,
    vehicleYear: rawSummary.vehicle_year ?? null,
    vehicleMake: rawSummary.vehicle_make ?? null,
    vehicleModel: rawSummary.vehicle_model ?? null,
    vehicleTrim: rawSummary.vehicle_trim ?? null,
    currentOffer: rawSummary.current_offer ?? null,
    listingPrice: rawSummary.listing_price ?? null,
    scoreOverall: rawSummary.score_overall ?? null,
    dealCount: rawSummary.deal_count ?? 0,
  }
}

function mapSession(rawSession: any): Session {
  return {
    id: rawSession.id,
    title: rawSession.title,
    sessionType: rawSession.session_type,
    linkedSessionIds: rawSession.linked_session_ids || [],
    lastMessagePreview: rawSession.last_message_preview || '',
    usage: rawSession.usage ? mapSessionUsage(rawSession.usage) : undefined,
    dealSummary: mapDealSummary(rawSession.deal_summary),
    updatedAt: rawSession.updated_at,
    createdAt: rawSession.created_at,
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

function mergeMessageUsage(
  base: MessageUsage | undefined,
  delta: MessageUsage | undefined
): MessageUsage | undefined {
  if (!base) return delta
  if (!delta) return base

  return {
    requests: (base.requests ?? 0) + (delta.requests ?? 0),
    inputTokens: (base.inputTokens ?? 0) + (delta.inputTokens ?? 0),
    outputTokens: (base.outputTokens ?? 0) + (delta.outputTokens ?? 0),
    cacheCreationInputTokens:
      (base.cacheCreationInputTokens ?? 0) + (delta.cacheCreationInputTokens ?? 0),
    cacheReadInputTokens: (base.cacheReadInputTokens ?? 0) + (delta.cacheReadInputTokens ?? 0),
    totalTokens: (base.totalTokens ?? 0) + (delta.totalTokens ?? 0),
  }
}

/** Map a single vehicle from backend snake_case to frontend Vehicle type. */
function mapVehicle(rawVehicle: any): import('./types').Vehicle {
  return {
    id: rawVehicle.id,
    role: rawVehicle.role,
    year: rawVehicle.year,
    make: rawVehicle.make,
    model: rawVehicle.model,
    trim: rawVehicle.trim ?? undefined,
    cabStyle: rawVehicle.cab_style ?? undefined,
    bedLength: rawVehicle.bed_length ?? undefined,
    vin: rawVehicle.vin ?? undefined,
    mileage: rawVehicle.mileage ?? undefined,
    color: rawVehicle.color ?? undefined,
    engine: rawVehicle.engine ?? undefined,
    identityConfirmationStatus: rawVehicle.identity_confirmation_status ?? 'unconfirmed',
    identityConfirmedAt: rawVehicle.identity_confirmed_at ?? null,
    identityConfirmationSource: rawVehicle.identity_confirmation_source ?? null,
    intelligence: rawVehicle.intelligence ? mapVehicleIntelligence(rawVehicle.intelligence) : null,
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
function mapDeal(rawDeal: any): import('./types').Deal {
  return {
    id: rawDeal.id,
    vehicleId: rawDeal.vehicle_id,
    dealerName: rawDeal.dealer_name ?? null,
    phase: rawDeal.phase,
    numbers: {
      msrp: rawDeal.msrp,
      invoicePrice: rawDeal.invoice_price,
      listingPrice: rawDeal.listing_price,
      yourTarget: rawDeal.your_target,
      walkAwayPrice: rawDeal.walk_away_price,
      currentOffer: rawDeal.current_offer,
      monthlyPayment: rawDeal.monthly_payment,
      apr: rawDeal.apr,
      loanTermMonths: rawDeal.loan_term_months,
      downPayment: rawDeal.down_payment,
      tradeInValue: rawDeal.trade_in_value,
    },
    scorecard: {
      price: rawDeal.score_price,
      financing: rawDeal.score_financing,
      tradeIn: rawDeal.score_trade_in,
      fees: rawDeal.score_fees,
      overall: rawDeal.score_overall,
    },
    health: rawDeal.health_status
      ? {
          status: rawDeal.health_status,
          summary: rawDeal.health_summary ?? '',
          recommendation: rawDeal.recommendation ?? null,
        }
      : null,
    redFlags: (rawDeal.red_flags ?? []).map((redFlag: any) => ({
      id: redFlag.id,
      severity: redFlag.severity,
      message: redFlag.message,
    })),
    informationGaps: (rawDeal.information_gaps ?? []).map((gap: any) => ({
      label: gap.label,
      reason: gap.reason,
      priority: gap.priority,
    })),
    firstOffer: rawDeal.first_offer ?? null,
    preFiPrice: rawDeal.pre_fi_price ?? null,
    savingsEstimate: rawDeal.savings_estimate ?? null,
  }
}

/** Map an AI panel card from backend snake_case to frontend AiPanelCard type. */
function mapAiPanelCardContent(
  template: import('./types').AiCardTemplate,
  content: any
): Record<string, any> {
  if (!content || typeof content !== 'object') return {}

  if (template === 'comparison') {
    const rawHighlights = Array.isArray(content.highlights) ? content.highlights : []
    return {
      ...content,
      bestDealId: content.best_deal_id ?? content.bestDealId,
      highlights: rawHighlights.map((highlight: any) => ({
        label: highlight.label,
        note: highlight.note ?? undefined,
        values: (Array.isArray(highlight?.values) ? highlight.values : []).map((value: any) => ({
          dealId: value.deal_id ?? value.dealId,
          value: value.value,
          isWinner: value.is_winner ?? value.isWinner ?? false,
        })),
      })),
    }
  }

  return content
}

function mapAiPanelCard(rawCard: any): import('./types').AiPanelCard {
  const kind = rawCard.kind as import('./types').AiCardKind
  const template = rawCard.template as import('./types').AiCardTemplate
  return {
    kind,
    template,
    title: rawCard.title,
    content: mapAiPanelCardContent(template, rawCard.content),
    priority: rawCard.priority,
  }
}

/** Map a deal comparison from backend to frontend DealComparison type. */
function mapDealComparison(rawComparison: any): import('./types').DealComparison | null {
  if (!rawComparison) return null
  return {
    summary: rawComparison.summary,
    recommendation: rawComparison.recommendation,
    bestDealId: rawComparison.best_deal_id,
    highlights: (rawComparison.highlights ?? []).map((highlight: any) => ({
      label: highlight.label,
      values: (highlight.values ?? []).map((comparisonValue: any) => ({
        dealId: comparisonValue.deal_id,
        value: comparisonValue.value,
        isWinner: comparisonValue.is_winner,
      })),
      note: highlight.note ?? undefined,
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
  cabStyle: 'cab_style',
  bedLength: 'bed_length',
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
    const sessionResponse = await request<any>('/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return mapSession(sessionResponse)
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

  async getMessages(sessionId: string): Promise<{
    messages: Message[]
    contextPressure: ContextPressure
  }> {
    const res = await request<any>(`/chat/${sessionId}/messages`)
    const raw = res.messages ?? []
    const cp = res.context_pressure ?? {}
    return {
      messages: raw.map((m: any) => ({
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
      })),
      contextPressure: {
        level: cp.level === 'warn' || cp.level === 'critical' ? cp.level : 'ok',
        estimatedInputTokens: Number(cp.estimated_input_tokens ?? 0),
        inputBudget: Number(cp.input_budget ?? 0),
      },
    }
  }

  sendMessage(
    sessionId: string,
    content: string,
    imageUri?: string,
    onChunk?: (text: string) => void,
    onToolResult?: (toolCall: ToolCall) => void,
    onTextDone?: (finalText: string, usage?: MessageUsage, sessionUsage?: SessionUsage) => void,
    onRetry?: (data: { attempt: number; reason: string }) => void,
    onStep?: (data: { step: number }) => void,
    onPanelStarted?: () => void,
    onPanelFinished?: () => void,
    onCompaction?: (phase: 'started' | 'done' | 'error') => void
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
      /** Chat-loop tool results only — held until `done` so the UI can finalize the reply before insights/deal updates. */
      const pendingDealToolResults: ToolCall[] = []
      let processed = 0
      let buffer = ''
      let sseError: string | null = null
      let panelStreamActive = false
      const streamedPanelCards: unknown[] = []

      const flushPendingDealToolResults = () => {
        if (pendingDealToolResults.length === 0) return
        for (const tc of pendingDealToolResults) {
          toolCalls.push(tc)
          onToolResult?.(tc)
        }
        pendingDealToolResults.length = 0
      }

      const finishPanelStream = () => {
        if (!panelStreamActive) return
        panelStreamActive = false
        onPanelFinished?.()
      }

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
              // Text streaming is complete — finalize immediately.
              // Panel cards continue in a separate async phase after this.
              fullText = data.text ?? fullText
              messageUsage = data.usage
              sessionUsage = data.sessionUsage ? mapSessionUsage(data.sessionUsage) : undefined
              onTextDone?.(fullText, messageUsage, sessionUsage)
              // Apply step-loop deal/insights-driving tools only after the reply is finalized.
              flushPendingDealToolResults()
            } else if (eventType === 'panel_started') {
              console.debug('[apiClient] panel stream started', data)
              panelStreamActive = true
              streamedPanelCards.length = 0
              onPanelStarted?.()
            } else if (eventType === 'panel_card' && data.card) {
              if (!panelStreamActive) {
                panelStreamActive = true
                streamedPanelCards.length = 0
              }
              const index =
                typeof data.index === 'number' && Number.isInteger(data.index) && data.index >= 0
                  ? data.index
                  : streamedPanelCards.length
              streamedPanelCards[index] = data.card
              const toolCall: ToolCall = {
                name: 'update_insights_panel',
                args: { mode: PANEL_UPDATE_MODE.APPEND, card: data.card, index },
              }
              toolCalls.push(toolCall)
              onToolResult?.(toolCall)
            } else if (eventType === 'panel_done') {
              if (data.usage) {
                messageUsage = mergeMessageUsage(messageUsage, data.usage)
              }
              finishPanelStream()
              const finalCards = (data.cards ?? []) as unknown[]
              // Always reconcile to server-final cards so empty results clear stale UI state.
              const toolCall: ToolCall = {
                name: 'update_insights_panel',
                args: { mode: PANEL_UPDATE_MODE.REPLACE, cards: finalCards },
              }
              toolCalls.push(toolCall)
              onToolResult?.(toolCall)
            } else if (eventType === 'panel_error') {
              console.warn('[apiClient] panel stream error:', data.message ?? data)
              finishPanelStream()
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
            } else if (eventType === 'compaction_started') {
              onCompaction?.('started')
            } else if (eventType === 'compaction_done') {
              onCompaction?.('done')
            } else if (eventType === 'compaction_error') {
              onCompaction?.('error')
            } else if (eventType === 'tool_error') {
              console.warn('[apiClient] Tool execution error:', data.tool, data.error)
            } else if (eventType === 'tool_result' && data.tool) {
              const toolCall: ToolCall = { name: data.tool as ToolCall['name'], args: data.data }
              pendingDealToolResults.push(toolCall)
            }
          } catch (e) {
            console.debug(
              '[apiClient] Skipping malformed SSE data',
              eventType || 'unknown_event',
              e instanceof Error ? e.message : e
            )
          }
        }
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          // Process any remaining data not caught by onprogress
          xhr.onprogress?.(null as any)
          // If the stream ended without a `done` event, still apply buffered deal tools.
          flushPendingDealToolResults()
          if (sseError) {
            finishPanelStream()
            reject(new Error(sseError))
            return
          }
          if (panelStreamActive) {
            console.warn('[apiClient] panel stream ended without terminal event')
            finishPanelStream()
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
          finishPanelStream()
          reject(new Error(`Chat API ${xhr.status}`))
        }
      }

      xhr.onerror = () => {
        finishPanelStream()
        reject(new Error('Network error'))
      }
      xhr.ontimeout = () => {
        finishPanelStream()
        reject(new Error('Request timed out'))
      }
      xhr.send(JSON.stringify({ content, image_url: imageUri }))
    })
  }

  // ─── Deal State ───

  async getDealState(sessionId: string): Promise<DealState> {
    const dealStateResponse = await request<any>(`/deal/${sessionId}`)
    return {
      sessionId: dealStateResponse.session_id,
      buyerContext: dealStateResponse.buyer_context || DEFAULT_BUYER_CONTEXT,
      activeDealId: dealStateResponse.active_deal_id ?? null,
      vehicles: (dealStateResponse.vehicles ?? []).map(mapVehicle),
      deals: (dealStateResponse.deals ?? []).map(mapDeal),
      redFlags: (dealStateResponse.red_flags ?? []).map((redFlag: any) => ({
        id: redFlag.id,
        severity: redFlag.severity,
        message: redFlag.message,
      })),
      informationGaps: (dealStateResponse.information_gaps ?? []).map((gap: any) => ({
        label: gap.label,
        reason: gap.reason,
        priority: gap.priority,
      })),
      checklist: dealStateResponse.checklist || [],
      timerStartedAt: dealStateResponse.timer_started_at ?? null,
      aiPanelCards: (dealStateResponse.ai_panel_cards ?? []).map(mapAiPanelCard),
      dealComparison: mapDealComparison(dealStateResponse.deal_comparison),
      negotiationContext: dealStateResponse.negotiation_context
        ? (snakeToCamel(dealStateResponse.negotiation_context) as DealState['negotiationContext'])
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
      redFlags: (res.red_flags ?? []).map((redFlag: any) => ({
        id: redFlag.id,
        severity: redFlag.severity,
        message: redFlag.message,
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
