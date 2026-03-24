import type { ApiService, Session, Message, DealState, Scenario } from '@/lib/types'
import { delay, generateId } from '@/lib/utils'
import { mockLogin, mockRegister } from './mockAuth'
import { MOCK_SESSIONS } from './mockSessions'
import { MOCK_SCENARIOS } from './mockScenarios'
import { createEmptyDealState, MOCK_DEAL_STATE_NEGOTIATION } from './mockDealStates'
import { findMockResponse, createUserMessage, createAssistantMessage } from './mockMessages'

class MockApiService implements ApiService {
  private sessions: Session[] = [...MOCK_SESSIONS]
  private messagesBySession: Record<string, Message[]> = {}
  private dealStates: Record<string, DealState> = {
    'session-1': { ...MOCK_DEAL_STATE_NEGOTIATION },
  }

  // ─── Auth ───

  async login(email: string, password: string) {
    return mockLogin(email, password)
  }

  async register(email: string, password: string, role: string) {
    return mockRegister(email, password, role)
  }

  // ─── Sessions ───

  async getSessions(): Promise<Session[]> {
    await delay(300)
    return [...this.sessions].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  }

  async createSession(type: 'buyer_chat' | 'dealer_sim', title?: string): Promise<Session> {
    await delay(300)
    const session: Session = {
      id: generateId(),
      title: title || (type === 'buyer_chat' ? 'New Deal' : 'New Simulation'),
      sessionType: type,
      linkedSessionIds: [],
      lastMessagePreview: '',
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    }
    this.sessions.unshift(session)
    this.dealStates[session.id] = createEmptyDealState(session.id)
    return session
  }

  async linkSessions(sessionId: string, linkedIds: string[]): Promise<void> {
    await delay(200)
    const session = this.sessions.find((s) => s.id === sessionId)
    if (session) {
      session.linkedSessionIds = linkedIds
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    await delay(200)
    this.sessions = this.sessions.filter((s) => s.id !== sessionId)
    delete this.messagesBySession[sessionId]
    delete this.dealStates[sessionId]
  }

  // ─── Chat ───

  async getMessages(sessionId: string): Promise<Message[]> {
    await delay(300)
    return this.messagesBySession[sessionId] || []
  }

  async sendMessage(sessionId: string, content: string, imageUri?: string): Promise<Message> {
    // Create and store user message
    const userMsg = createUserMessage(sessionId, content, imageUri)
    if (!this.messagesBySession[sessionId]) {
      this.messagesBySession[sessionId] = []
    }
    this.messagesBySession[sessionId].push(userMsg)

    // Simulate thinking delay
    await delay(600 + Math.random() * 400)

    // Find matching response
    const response = findMockResponse(content)
    const assistantMsg = createAssistantMessage(sessionId, response)
    this.messagesBySession[sessionId].push(assistantMsg)

    // Update session preview
    const session = this.sessions.find((s) => s.id === sessionId)
    if (session) {
      session.lastMessagePreview = response.content.substring(0, 80)
      session.updatedAt = new Date().toISOString()
    }

    return assistantMsg
  }

  // ─── Deal State ───

  async getDealState(sessionId: string): Promise<DealState> {
    await delay(200)
    if (!this.dealStates[sessionId]) {
      this.dealStates[sessionId] = createEmptyDealState(sessionId)
    }
    return { ...this.dealStates[sessionId] }
  }

  // ─── Simulations ───

  async getScenarios(): Promise<Scenario[]> {
    await delay(300)
    return [...MOCK_SCENARIOS]
  }

  async startSimulation(scenarioId: string): Promise<Session> {
    const scenario = MOCK_SCENARIOS.find((s) => s.id === scenarioId)
    const title = scenario ? scenario.title : 'Simulation'
    return this.createSession('dealer_sim', title)
  }
}

export { MockApiService }
