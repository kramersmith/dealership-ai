import type {
  ApiService,
  BuyerContext,
  Session,
  Message,
  DealState,
  RedFlag,
  Scenario,
  ToolCall,
} from './types'
import { DEFAULT_BUYER_CONTEXT } from './constants'

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
  }
}

function mapSession(s: any): Session {
  return {
    id: s.id,
    title: s.title,
    sessionType: s.session_type,
    linkedSessionIds: s.linked_session_ids || [],
    lastMessagePreview: s.last_message_preview || '',
    dealSummary: mapDealSummary(s.deal_summary),
    updatedAt: s.updated_at,
    createdAt: s.created_at,
  }
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
      createdAt: m.created_at,
    }))
  }

  sendMessage(
    sessionId: string,
    content: string,
    imageUri?: string,
    onChunk?: (text: string) => void
  ): Promise<Message> {
    // Use XMLHttpRequest for true incremental streaming — fetch's ReadableStream
    // is buffered by React Native's polyfill and doesn't deliver chunks live.
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${API_BASE}/chat/${sessionId}/message`)
      xhr.setRequestHeader('Content-Type', 'application/json')
      if (authToken) xhr.setRequestHeader('Authorization', `Bearer ${authToken}`)

      let fullText = ''
      const toolCalls: ToolCall[] = []
      let processed = 0
      let buffer = ''

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
            if ((eventType === 'text' || eventType === 'followup_text') && data.chunk) {
              fullText += data.chunk
              onChunk?.(fullText)
            } else if (eventType === 'tool_result' && data.tool) {
              toolCalls.push({ name: data.tool as ToolCall['name'], args: data.data })
            }
          } catch {
            // Skip malformed SSE data
          }
        }
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          // Process any remaining data not caught by onprogress
          xhr.onprogress?.(null as any)
          resolve({
            id: Math.random().toString(36).substring(2),
            sessionId,
            role: 'assistant',
            content: fullText,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            createdAt: new Date().toISOString(),
          })
        } else {
          reject(new Error(`Chat API ${xhr.status}`))
        }
      }

      xhr.onerror = () => reject(new Error('Network error'))
      xhr.send(JSON.stringify({ content, image_url: imageUri }))
    })
  }

  // ─── Deal State ───

  async getDealState(sessionId: string): Promise<DealState> {
    const ds = await request<any>(`/deal/${sessionId}`)
    return {
      sessionId: ds.session_id,
      phase: ds.phase,
      buyerContext: ds.buyer_context || DEFAULT_BUYER_CONTEXT,
      numbers: {
        msrp: ds.msrp,
        invoicePrice: ds.invoice_price,
        listingPrice: ds.listing_price,
        yourTarget: ds.your_target,
        walkAwayPrice: ds.walk_away_price,
        currentOffer: ds.current_offer,
        monthlyPayment: ds.monthly_payment,
        apr: ds.apr,
        loanTermMonths: ds.loan_term_months,
        downPayment: ds.down_payment,
        tradeInValue: ds.trade_in_value,
      },
      vehicle: ds.vehicle_make
        ? {
            year: ds.vehicle_year,
            make: ds.vehicle_make,
            model: ds.vehicle_model,
            trim: ds.vehicle_trim,
            vin: ds.vehicle_vin,
            mileage: ds.vehicle_mileage,
            color: ds.vehicle_color,
          }
        : null,
      scorecard: {
        price: ds.score_price,
        financing: ds.score_financing,
        tradeIn: ds.score_trade_in,
        fees: ds.score_fees,
        overall: ds.score_overall,
      },
      checklist: ds.checklist || [],
      timerStartedAt: ds.timer_started_at,
      health: ds.health_status
        ? {
            status: ds.health_status,
            summary: ds.health_summary ?? '',
            recommendation: ds.recommendation ?? null,
          }
        : null,
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
      firstOffer: ds.first_offer ?? null,
      preFiPrice: ds.pre_fi_price ?? null,
      savingsEstimate: ds.savings_estimate ?? null,
    }
  }

  async correctDealState(
    sessionId: string,
    corrections: Record<string, string | number | null>
  ): Promise<{
    healthStatus: string | null
    healthSummary: string | null
    recommendation: string | null
    redFlags: RedFlag[]
  }> {
    const res = await request<any>(`/deal/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify(corrections),
    })
    return {
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
