import type { ApiService, BuyerContext, Session, Message, DealState, Scenario, ToolCall } from './types'
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

function mapSession(s: any): Session {
  return {
    id: s.id,
    title: s.title,
    sessionType: s.session_type,
    linkedSessionIds: s.linked_session_ids || [],
    lastMessagePreview: '',
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

  async sendMessage(sessionId: string, content: string, imageUri?: string): Promise<Message> {
    // This method sends and consumes the SSE stream, returning the final message
    const res = await fetch(`${API_BASE}/chat/${sessionId}/message`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ content, image_url: imageUri }),
    })

    if (!res.ok) {
      throw new Error(`Chat API ${res.status}`)
    }

    // Read SSE stream
    const reader = res.body?.getReader()
    const decoder = new TextDecoder()

    let fullText = ''
    const toolCalls: ToolCall[] = []
    let buffer = ''
    let currentEvent = ''

    if (reader) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            const payload = line.slice(6)
            try {
              const data = JSON.parse(payload)
              if (currentEvent === 'text' && data.chunk) {
                fullText += data.chunk
              } else if (currentEvent === 'tool_result' && data.tool) {
                toolCalls.push({ name: data.tool as ToolCall['name'], args: data.data })
              }
            } catch {
              // Skip malformed SSE data lines
            }
            currentEvent = ''
          }
        }
      }
    }

    return {
      id: Math.random().toString(36).substring(2),
      sessionId,
      role: 'assistant',
      content: fullText,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      createdAt: new Date().toISOString(),
    }
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
        theirOffer: ds.their_offer,
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
