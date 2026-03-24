import { create } from 'zustand'
import type { Message, Session } from '@/lib/types'
import { api } from '@/lib/api'
import { useDealStore } from './dealStore'

interface ChatState {
  activeSessionId: string | null
  messages: Message[]
  sessions: Session[]
  isLoading: boolean
  isSending: boolean

  loadSessions: () => Promise<void>
  loadMessages: (sessionId: string) => Promise<void>
  setActiveSession: (sessionId: string) => Promise<void>
  createSession: (type: 'buyer_chat' | 'dealer_sim', title?: string) => Promise<Session>
  deleteSession: (sessionId: string) => Promise<void>
  sendMessage: (content: string, imageUri?: string) => Promise<void>
}

export const useChatStore = create<ChatState>((set, get) => ({
  activeSessionId: null,
  messages: [],
  sessions: [],
  isLoading: false,
  isSending: false,

  loadSessions: async () => {
    set({ isLoading: true })
    try {
      const sessions = await api.getSessions()
      set({ sessions, isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },

  loadMessages: async (sessionId) => {
    set({ isLoading: true })
    try {
      const messages = await api.getMessages(sessionId)
      set({ messages, isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },

  setActiveSession: async (sessionId) => {
    set({ activeSessionId: sessionId, messages: [], isLoading: true })
    try {
      const [messages] = await Promise.all([
        api.getMessages(sessionId),
        useDealStore.getState().loadDealState(sessionId),
      ])
      set({ messages, isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },

  createSession: async (type, title) => {
    const session = await api.createSession(type, title)
    set((state) => ({
      sessions: [session, ...state.sessions],
      activeSessionId: session.id,
      messages: [],
    }))
    useDealStore.getState().resetDealState(session.id)
    return session
  },

  deleteSession: async (sessionId) => {
    await api.deleteSession(sessionId)
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== sessionId),
      activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
      messages: state.activeSessionId === sessionId ? [] : state.messages,
    }))
  },

  sendMessage: async (content, imageUri) => {
    const { activeSessionId } = get()
    if (!activeSessionId) return

    // Optimistically add user message
    const userMessage: Message = {
      id: Math.random().toString(36).substring(2),
      sessionId: activeSessionId,
      role: 'user',
      content,
      imageUri,
      createdAt: new Date().toISOString(),
    }
    set((state) => ({ messages: [...state.messages, userMessage], isSending: true }))

    try {
      // Get assistant response (mock returns the message with tool calls)
      const assistantMessage = await api.sendMessage(activeSessionId, content, imageUri)

      // Add assistant message to chat
      set((state) => ({
        messages: [...state.messages, assistantMessage],
        isSending: false,
      }))

      // Process tool calls → update dashboard
      if (assistantMessage.toolCalls) {
        const dealStore = useDealStore.getState()
        for (const toolCall of assistantMessage.toolCalls) {
          dealStore.applyToolCall(toolCall)
        }
      }

      // Refresh sessions list to update preview
      get().loadSessions()
    } catch {
      set({ isSending: false })
    }
  },
}))
