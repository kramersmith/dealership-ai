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
  UserSettings,
} from './types'
import { DEFAULT_BUYER_CONTEXT } from './constants'
import { snakeToCamel } from './utils'

const API_BASE = 'http://localhost:8001/api'
export const CLIENT_ABORT_ERROR = '__CHAT_STREAM_ABORTED__'

let authToken: string | null = null
const activeStreamRequests = new Map<string, XMLHttpRequest>()

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
    throw new Error(extractHttpErrorMessage(res.status, text, 'API'))
  }
  return res.json()
}

function extractStructuredErrorMessage(responseText: string): string | null {
  const trimmed = responseText.trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed) as { detail?: unknown; message?: unknown }
    if (typeof parsed.detail === 'string' && parsed.detail.trim()) {
      return parsed.detail.trim()
    }
    if (typeof parsed.message === 'string' && parsed.message.trim()) {
      return parsed.message.trim()
    }
  } catch {
    return null
  }

  return null
}

function extractHttpErrorMessage(
  status: number,
  responseText: string,
  fallbackPrefix: 'API' | 'Chat API'
): string {
  const fallback = `${fallbackPrefix} ${status}`
  const trimmed = responseText.trim()
  if (!trimmed) return fallback

  const canExposeClientDetail = status >= 400 && status < 500

  if (!canExposeClientDetail) {
    return fallback
  }

  const structuredMessage = extractStructuredErrorMessage(trimmed)
  if (structuredMessage) return structuredMessage

  return fallback
}

function extractStreamErrorMessage(status: number, responseText: string): string {
  return extractHttpErrorMessage(status, responseText, 'Chat API')
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

function mapUserSettings(rawSettings: any): UserSettings {
  const rawMode = rawSettings?.insights_update_mode
  return {
    insightsUpdateMode: rawMode === 'paused' || rawMode === 'manual' ? 'paused' : 'live',
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

function mapMessage(raw: any): import('./types').Message {
  return {
    id: raw.id,
    sessionId: raw.session_id,
    role: raw.role,
    content: raw.content,
    imageUri: raw.image_url,
    toolCalls: raw.tool_calls?.map((tc: any) => ({
      name: tc.name as import('./types').ToolCall['name'],
      args: tc.args,
    })),
    panelCards: raw.panel_cards?.map((c: any) => mapAiPanelCard(c)),
    usage: raw.usage,
    completionStatus: raw.completion_status ?? 'complete',
    interruptedAt: raw.interrupted_at ?? null,
    interruptedReason: raw.interrupted_reason ?? null,
    createdAt: raw.created_at,
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

type StreamBuyerChatCallbacks = {
  onChunk?: (text: string) => void
  onTurnStarted?: (data: { turnId: string }) => void
  onToolResult?: (toolCall: ToolCall) => void
  onTextDone?: (finalText: string, usage?: MessageUsage, sessionUsage?: SessionUsage) => void
  onInterrupted?: (data: {
    text: string
    reason: string
    assistantMessageId?: string
    usage?: MessageUsage
  }) => void
  onNonFatalError?: (message: string) => void
  onRetry?: (data: { attempt: number; reason: string }) => void
  onStep?: (data: { step: number }) => void
  onPanelStarted?: () => void
  onPanelFinished?: () => void
  onPanelInterrupted?: (data: { reason: string }) => void
  onCompaction?: (phase: 'started' | 'done' | 'error') => void
}

type StreamInsightsFollowupCallbacks = {
  onToolResult?: (toolCall: ToolCall) => void
  onPanelStarted?: () => void
  onPanelFinished?: () => void
  onPanelInterrupted?: (data: { reason: string }) => void
  onNonFatalError?: (message: string) => void
}

/** Shared XHR + SSE parser for POST /chat/.../message and .../branch. */
function streamBuyerChatSse(
  pathRelativeToApi: string,
  body: Record<string, unknown>,
  sessionId: string,
  callbacks: StreamBuyerChatCallbacks
): Promise<Message> {
  const {
    onChunk,
    onTurnStarted,
    onToolResult,
    onTextDone,
    onInterrupted,
    onNonFatalError,
    onRetry,
    onStep,
    onPanelStarted,
    onPanelFinished,
    onPanelInterrupted,
    onCompaction,
  } = callbacks

  return new Promise((resolve, reject) => {
    const streamRequest = new XMLHttpRequest()
    streamRequest.open('POST', `${API_BASE}/${pathRelativeToApi}`)
    streamRequest.setRequestHeader('Content-Type', 'application/json')
    if (authToken) streamRequest.setRequestHeader('Authorization', `Bearer ${authToken}`)

    streamRequest.timeout = 150000
    activeStreamRequests.set(sessionId, streamRequest)

    let fullText = ''
    let assistantMessageId: string | undefined
    let messageUsage: MessageUsage | undefined
    let sessionUsage: SessionUsage | undefined
    const toolCalls: ToolCall[] = []
    const pendingDealToolResults: ToolCall[] = []
    let processed = 0
    let buffer = ''
    let sseError: string | null = null
    let protocolError: string | null = null
    let sawDoneEvent = false
    let panelStreamActive = false
    let interruptedPayload: {
      text: string
      reason: string
      assistantMessageId?: string
      usage?: MessageUsage
    } | null = null

    const flushPendingDealToolResults = () => {
      if (pendingDealToolResults.length === 0) return
      for (const pendingToolCall of pendingDealToolResults) {
        toolCalls.push(pendingToolCall)
        onToolResult?.(pendingToolCall)
      }
      pendingDealToolResults.length = 0
    }

    const finishPanelStream = () => {
      if (!panelStreamActive) return
      panelStreamActive = false
      onPanelFinished?.()
    }

    const processSseMessage = (message: string) => {
      if (!message.trim()) return

      let eventType = ''
      const dataLines: string[] = []

      for (const line of message.split('\n')) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim()
        } else if (line.startsWith('data: ')) {
          dataLines.push(line.slice(6))
        }
      }

      const dataStr = dataLines.join('\n')
      if (!eventType || !dataStr) return

      try {
        const data = JSON.parse(dataStr)
        if (interruptedPayload && eventType !== 'error') {
          return
        }
        if (eventType === 'turn_started' && typeof data.turn_id === 'string') {
          onTurnStarted?.({ turnId: data.turn_id })
        } else if (eventType === 'text' && data.chunk) {
          fullText += data.chunk
          onChunk?.(fullText)
        } else if (eventType === 'done') {
          sawDoneEvent = true
          fullText = data.text ?? fullText
          assistantMessageId =
            typeof data.assistant_message_id === 'string' ? data.assistant_message_id : undefined
          messageUsage = data.usage
          sessionUsage = data.sessionUsage ? mapSessionUsage(data.sessionUsage) : undefined
          onTextDone?.(fullText, messageUsage, sessionUsage)
          flushPendingDealToolResults()
        } else if (eventType === 'panel_started') {
          console.debug('[apiClient] panel stream started')
          panelStreamActive = true
          onPanelStarted?.()
        } else if (eventType === 'panel_done') {
          if (!panelStreamActive) {
            panelStreamActive = true
            onPanelStarted?.()
          }
          if (data.usage) {
            messageUsage = mergeMessageUsage(messageUsage, data.usage)
          }
          const finalCards = (data.cards ?? []) as unknown[]
          const assistantMessageId =
            typeof data.assistant_message_id === 'string' ? data.assistant_message_id : undefined
          const toolCall: ToolCall = {
            name: 'update_insights_panel',
            args: {
              cards: finalCards,
              ...(assistantMessageId ? { assistantMessageId } : {}),
            },
          }
          toolCalls.push(toolCall)
          onToolResult?.(toolCall)
          finishPanelStream()
        } else if (eventType === 'panel_error') {
          console.warn('[apiClient] panel stream error')
          finishPanelStream()
        } else if (eventType === 'panel_interrupted') {
          console.info('[apiClient] panel stream interrupted')
          finishPanelStream()
          onPanelInterrupted?.({
            reason: typeof data.reason === 'string' ? data.reason : 'user_stop',
          })
        } else if (eventType === 'interrupted') {
          fullText = typeof data.text === 'string' ? data.text : fullText
          messageUsage = data.usage ?? messageUsage
          interruptedPayload = {
            text: fullText,
            reason: typeof data.reason === 'string' ? data.reason : 'user_stop',
            assistantMessageId:
              typeof data.assistant_message_id === 'string' ? data.assistant_message_id : undefined,
            usage: data.usage,
          }
          onInterrupted?.(interruptedPayload)
          flushPendingDealToolResults()
          finishPanelStream()
        } else if (eventType === 'error') {
          const errorMessage =
            typeof data.message === 'string' && data.message.trim().length > 0
              ? data.message
              : 'An error occurred'
          if (sawDoneEvent) {
            console.error('[apiClient] non-fatal SSE error event after done')
            onNonFatalError?.(errorMessage)
          } else {
            console.error('[apiClient] SSE error event')
            sseError = errorMessage
          }
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
          console.warn(
            '[apiClient] Tool execution error:',
            typeof data.tool === 'string' ? data.tool : 'unknown_tool'
          )
        } else if (eventType === 'tool_result' && data.tool) {
          const toolCall: ToolCall = { name: data.tool as ToolCall['name'], args: data.data }
          pendingDealToolResults.push(toolCall)
        }
      } catch (parseError) {
        if (!sawDoneEvent) {
          protocolError = 'Received an invalid response from the chat service'
          console.error(
            '[apiClient] Malformed SSE payload before done event',
            eventType || 'unknown_event',
            parseError instanceof Error ? parseError.message : parseError
          )
          streamRequest.abort()
          return
        }

        console.warn(
          '[apiClient] Ignoring malformed post-text SSE payload',
          eventType || 'unknown_event',
          parseError instanceof Error ? parseError.message : parseError
        )
        finishPanelStream()
      }
    }

    const processBufferedMessages = (includeTrailingMessage: boolean) => {
      const messages = buffer.split('\n\n')
      if (!includeTrailingMessage) {
        buffer = messages.pop() ?? ''
      } else {
        buffer = ''
      }

      for (const message of messages) {
        processSseMessage(message)
        if (protocolError) return
      }
    }

    streamRequest.onprogress = () => {
      const newData = streamRequest.responseText.slice(processed)
      processed = streamRequest.responseText.length
      buffer += newData

      processBufferedMessages(false)
    }

    streamRequest.onload = () => {
      if (activeStreamRequests.get(sessionId) === streamRequest) {
        activeStreamRequests.delete(sessionId)
      }
      if (streamRequest.status >= 200 && streamRequest.status < 300) {
        const newData = streamRequest.responseText.slice(processed)
        processed = streamRequest.responseText.length
        buffer += newData
        processBufferedMessages(true)
        if (protocolError) {
          finishPanelStream()
          reject(new Error(protocolError))
          return
        }
        if (sseError) {
          finishPanelStream()
          reject(new Error(sseError))
          return
        }
        if (interruptedPayload) {
          resolve({
            id: interruptedPayload.assistantMessageId ?? Math.random().toString(36).substring(2),
            sessionId,
            role: 'assistant',
            content: interruptedPayload.text,
            usage: interruptedPayload.usage ?? messageUsage,
            completionStatus: 'interrupted',
            interruptedAt: new Date().toISOString(),
            interruptedReason: interruptedPayload.reason,
            createdAt: new Date().toISOString(),
          })
          return
        }
        // If the stream ended without a `done` event, still apply buffered deal tools
        // and resolve with whatever text we accumulated. Matches the pre-refactor
        // behavior covered by the panel-cleanup-without-terminal-event tests.
        flushPendingDealToolResults()
        if (panelStreamActive) {
          console.warn('[apiClient] panel stream ended without terminal event')
          finishPanelStream()
        }
        resolve({
          id: assistantMessageId ?? Math.random().toString(36).substring(2),
          sessionId,
          role: 'assistant',
          content: fullText,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          usage: messageUsage,
          createdAt: new Date().toISOString(),
        })
      } else {
        finishPanelStream()
        reject(
          new Error(extractStreamErrorMessage(streamRequest.status, streamRequest.responseText))
        )
      }
    }

    streamRequest.onerror = () => {
      if (activeStreamRequests.get(sessionId) === streamRequest) {
        activeStreamRequests.delete(sessionId)
      }
      finishPanelStream()
      if ((streamRequest as any).__abortedByClient) {
        reject(new Error(CLIENT_ABORT_ERROR))
        return
      }
      reject(new Error(protocolError ?? 'Network error'))
    }
    streamRequest.onabort = () => {
      if (activeStreamRequests.get(sessionId) === streamRequest) {
        activeStreamRequests.delete(sessionId)
      }
      finishPanelStream()
      if (protocolError) {
        reject(new Error(protocolError))
        return
      }
      reject(new Error(CLIENT_ABORT_ERROR))
    }
    streamRequest.ontimeout = () => {
      if (activeStreamRequests.get(sessionId) === streamRequest) {
        activeStreamRequests.delete(sessionId)
      }
      finishPanelStream()
      reject(new Error('Request timed out'))
    }
    streamRequest.send(JSON.stringify(body))
  })
}

function streamInsightsFollowupSse(
  pathRelativeToApi: string,
  body: Record<string, unknown>,
  callbacks: StreamInsightsFollowupCallbacks
): Promise<void> {
  const { onToolResult, onPanelStarted, onPanelFinished, onPanelInterrupted, onNonFatalError } =
    callbacks

  return new Promise((resolve, reject) => {
    const streamRequest = new XMLHttpRequest()
    streamRequest.open('POST', `${API_BASE}/${pathRelativeToApi}`)
    streamRequest.setRequestHeader('Content-Type', 'application/json')
    if (authToken) streamRequest.setRequestHeader('Authorization', `Bearer ${authToken}`)

    streamRequest.timeout = 150000

    let processed = 0
    let buffer = ''
    let protocolError: string | null = null
    let sseError: string | null = null
    let panelStreamActive = false
    let sawFollowupTerminalEvent = false

    const finishPanelStream = () => {
      if (!panelStreamActive) return
      panelStreamActive = false
      onPanelFinished?.()
    }

    const processSseMessage = (message: string) => {
      if (!message.trim()) return

      let eventType = ''
      const dataLines: string[] = []

      for (const line of message.split('\n')) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim()
        } else if (line.startsWith('data: ')) {
          dataLines.push(line.slice(6))
        }
      }

      const dataStr = dataLines.join('\n')
      if (!eventType || !dataStr) return

      try {
        const data = JSON.parse(dataStr)
        if (eventType === 'panel_started') {
          panelStreamActive = true
          onPanelStarted?.()
        } else if (eventType === 'tool_result' && data.tool) {
          onToolResult?.({
            name: data.tool as ToolCall['name'],
            args: data.data,
          })
        } else if (eventType === 'panel_done') {
          sawFollowupTerminalEvent = true
          if (!panelStreamActive) {
            panelStreamActive = true
            onPanelStarted?.()
          }
          const assistantMessageId =
            typeof data.assistant_message_id === 'string' ? data.assistant_message_id : undefined
          onToolResult?.({
            name: 'update_insights_panel',
            args: {
              cards: (data.cards ?? []) as unknown[],
              ...(assistantMessageId ? { assistantMessageId } : {}),
            },
          })
          finishPanelStream()
        } else if (eventType === 'panel_interrupted') {
          sawFollowupTerminalEvent = true
          finishPanelStream()
          onPanelInterrupted?.({
            reason: typeof data.reason === 'string' ? data.reason : 'user_stop',
          })
        } else if (eventType === 'panel_error') {
          sawFollowupTerminalEvent = true
          const errorMessage =
            typeof data.message === 'string' && data.message.trim().length > 0
              ? data.message
              : 'Insights follow-up failed'
          sseError = errorMessage
          finishPanelStream()
        } else if (eventType === 'error') {
          const errorMessage =
            typeof data.message === 'string' && data.message.trim().length > 0
              ? data.message
              : 'Insights follow-up failed'
          onNonFatalError?.(errorMessage)
        }
      } catch (parseError) {
        protocolError = 'Received an invalid response from the insights service'
        console.error(
          '[apiClient] Malformed insights follow-up SSE payload',
          eventType || 'unknown_event',
          parseError instanceof Error ? parseError.message : parseError
        )
        streamRequest.abort()
      }
    }

    const processBufferedMessages = (includeTrailingMessage: boolean) => {
      const messages = buffer.split('\n\n')
      if (!includeTrailingMessage) {
        buffer = messages.pop() ?? ''
      } else {
        buffer = ''
      }

      for (const message of messages) {
        processSseMessage(message)
        if (protocolError) return
      }
    }

    streamRequest.onprogress = () => {
      const newData = streamRequest.responseText.slice(processed)
      processed = streamRequest.responseText.length
      buffer += newData
      processBufferedMessages(false)
    }

    streamRequest.onload = () => {
      if (streamRequest.status >= 200 && streamRequest.status < 300) {
        const newData = streamRequest.responseText.slice(processed)
        processed = streamRequest.responseText.length
        buffer += newData
        processBufferedMessages(true)
        if (protocolError) {
          finishPanelStream()
          reject(new Error(protocolError))
          return
        }
        if (sseError) {
          finishPanelStream()
          reject(new Error(sseError))
          return
        }
        if (!sawFollowupTerminalEvent) {
          finishPanelStream()
          reject(new Error('Insights follow-up ended without a terminal event'))
          return
        }
        finishPanelStream()
        resolve()
      } else {
        finishPanelStream()
        reject(
          new Error(extractStreamErrorMessage(streamRequest.status, streamRequest.responseText))
        )
      }
    }

    streamRequest.onerror = () => {
      finishPanelStream()
      reject(new Error(protocolError ?? 'Network error'))
    }
    streamRequest.onabort = () => {
      finishPanelStream()
      reject(new Error(protocolError ?? CLIENT_ABORT_ERROR))
    }
    streamRequest.ontimeout = () => {
      finishPanelStream()
      reject(new Error('Request timed out'))
    }
    streamRequest.send(JSON.stringify(body))
  })
}

class ApiClient implements ApiService {
  // ─── Auth ───

  async login(email: string, password: string) {
    const data = await request<{
      access_token: string
      user_id: string
      role: string
      settings: { insights_update_mode: string }
    }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
    setAuthToken(data.access_token)
    return { userId: data.user_id, role: data.role, settings: mapUserSettings(data.settings) }
  }

  async register(email: string, password: string, role: string) {
    const data = await request<{
      access_token: string
      user_id: string
      role: string
      settings: { insights_update_mode: string }
    }>('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, role }) })
    setAuthToken(data.access_token)
    return { userId: data.user_id, role: data.role, settings: mapUserSettings(data.settings) }
  }

  async getUserSettings() {
    const data = await request<{
      insights_update_mode: string
    }>('/auth/settings')
    return mapUserSettings(data)
  }

  async updateUserSettings(patch: Partial<UserSettings>) {
    const body: Record<string, unknown> = {}
    if (patch.insightsUpdateMode != null) {
      body.insights_update_mode = patch.insightsUpdateMode
    }
    const data = await request<{
      insights_update_mode: string
    }>('/auth/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
    return mapUserSettings(data)
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
      throw new Error(extractHttpErrorMessage(res.status, text, 'API'))
    }
  }

  // ─── Chat ───

  async getMessages(sessionId: string): Promise<{
    messages: Message[]
    contextPressure: ContextPressure
  }> {
    const res = await request<any>(`/chat/${sessionId}/messages`)
    const rawMessages = res.messages ?? []
    const rawContextPressure = res.context_pressure ?? {}
    return {
      messages: rawMessages.map(mapMessage),
      contextPressure: {
        level:
          rawContextPressure.level === 'warn' || rawContextPressure.level === 'critical'
            ? rawContextPressure.level
            : 'ok',
        estimatedInputTokens: Number(rawContextPressure.estimated_input_tokens ?? 0),
        inputBudget: Number(rawContextPressure.input_budget ?? 0),
      },
    }
  }

  async persistUserMessage(
    sessionId: string,
    content: string,
    imageUri?: string
  ): Promise<Message> {
    const persistedUserMessage = await request<any>(`/chat/${sessionId}/user-message`, {
      method: 'POST',
      body: JSON.stringify({ content, image_url: imageUri ?? null }),
    })
    return mapMessage(persistedUserMessage)
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
    onCompaction?: (phase: 'started' | 'done' | 'error') => void,
    onTurnStarted?: (data: { turnId: string }) => void,
    onInterrupted?: (data: {
      text: string
      reason: string
      assistantMessageId?: string
      usage?: MessageUsage
    }) => void,
    onPanelInterrupted?: (data: { reason: string }) => void,
    existingUserMessageId?: string,
    onNonFatalError?: (message: string) => void
  ): Promise<Message> {
    const payload: Record<string, unknown> = {
      content,
      image_url: imageUri ?? null,
    }
    if (existingUserMessageId) {
      payload.existing_user_message_id = existingUserMessageId
    }
    return streamBuyerChatSse(`chat/${sessionId}/message`, payload, sessionId, {
      onChunk,
      onTurnStarted,
      onToolResult,
      onTextDone,
      onInterrupted,
      onRetry,
      onStep,
      onPanelStarted,
      onPanelFinished,
      onCompaction,
      onPanelInterrupted,
      onNonFatalError,
    })
  }

  branchFromUserMessage(
    sessionId: string,
    anchorUserMessageId: string,
    content: string,
    imageUri?: string,
    onChunk?: (text: string) => void,
    onToolResult?: (toolCall: ToolCall) => void,
    onTextDone?: (finalText: string, usage?: MessageUsage, sessionUsage?: SessionUsage) => void,
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
  ): Promise<Message> {
    return streamBuyerChatSse(
      `chat/${sessionId}/messages/${anchorUserMessageId}/branch`,
      { content, image_url: imageUri ?? null },
      sessionId,
      {
        onChunk,
        onTurnStarted,
        onToolResult,
        onTextDone,
        onInterrupted,
        onRetry,
        onStep,
        onPanelStarted,
        onPanelFinished,
        onCompaction,
        onPanelInterrupted,
        onNonFatalError,
      }
    )
  }

  async stopGeneration(sessionId: string, turnId?: string) {
    const response = await request<{ status: string; turn_id?: string; cancelled: boolean }>(
      `/chat/${sessionId}/stop`,
      {
        method: 'POST',
        body: JSON.stringify({
          turn_id: turnId ?? null,
          reason: 'user_stop',
        }),
      }
    )
    return {
      status: response.status,
      turnId: response.turn_id,
      cancelled: response.cancelled,
    }
  }

  startInsightsFollowup(
    sessionId: string,
    assistantMessageId: string,
    onToolResult?: (toolCall: ToolCall) => void,
    onPanelStarted?: () => void,
    onPanelFinished?: () => void,
    onPanelInterrupted?: (data: { reason: string }) => void,
    onNonFatalError?: (message: string) => void
  ) {
    return streamInsightsFollowupSse(
      `chat/${sessionId}/insights-followup`,
      { assistant_message_id: assistantMessageId },
      {
        onToolResult,
        onPanelStarted,
        onPanelFinished,
        onPanelInterrupted,
        onNonFatalError,
      }
    )
  }

  async refreshInsightsPanel(sessionId: string) {
    const response = await request<{ cards: any[]; assistant_message_id: string }>(
      `/chat/${sessionId}/panel-refresh`,
      { method: 'POST' }
    )
    return {
      cards: (response.cards ?? []).map((card) => mapAiPanelCard(card)),
      assistantMessageId: response.assistant_message_id,
    }
  }

  cancelActiveStream(sessionId: string): boolean {
    const streamRequest = activeStreamRequests.get(sessionId)
    if (!streamRequest) return false
    ;(streamRequest as any).__abortedByClient = true
    streamRequest.abort()
    activeStreamRequests.delete(sessionId)
    return true
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
      payload.vehicle_corrections = corrections.vehicleCorrections.map((vehicleCorrection) =>
        toSnakeCase(vehicleCorrection, VEHICLE_FIELD_MAP)
      )
    }

    if (corrections.dealCorrections) {
      payload.deal_corrections = corrections.dealCorrections.map((dealCorrection) =>
        toSnakeCase(dealCorrection, DEAL_FIELD_MAP)
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
    return scenarios.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      description: scenario.description,
      difficulty: scenario.difficulty,
      aiPersona: scenario.ai_persona,
    }))
  }

  async startSimulation(_scenarioId: string): Promise<Session> {
    return this.createSession('dealer_sim', 'Simulation')
  }
}

export { ApiClient }
