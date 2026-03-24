import { create } from 'zustand'
import type { Message, Session } from '@/lib/types'
import { api } from '@/lib/api'
import { useDealStore } from './dealStore'

interface ChatState {
  activeSessionId: string | null
  messages: Message[]
  sessions: Session[]
  isLoading: boolean
  isCreatingSession: boolean
  isSending: boolean
  sendError: string | null

  loadSessions: () => Promise<void>
  loadMessages: (sessionId: string) => Promise<void>
  setActiveSession: (sessionId: string) => Promise<void>
  createSession: (type: 'buyer_chat' | 'dealer_sim', title?: string) => Promise<Session | null>
  deleteSession: (sessionId: string) => Promise<void>
  sendMessage: (content: string, imageUri?: string) => Promise<void>
  clearSendError: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  activeSessionId: null,
  messages: [],
  sessions: [],
  isLoading: false,
  isCreatingSession: false,
  isSending: false,
  sendError: null,

  loadSessions: async () => {
    set({ isLoading: true })
    try {
      const sessions = await api.getSessions()
      set({ sessions, isLoading: false })
    } catch (err) {
      console.error('[chatStore] loadSessions failed:', err instanceof Error ? err.message : err)
      set({ isLoading: false })
    }
  },

  loadMessages: async (sessionId) => {
    set({ isLoading: true })
    try {
      const messages = await api.getMessages(sessionId)
      set({ messages, isLoading: false })
    } catch (err) {
      console.error('[chatStore] loadMessages failed:', err instanceof Error ? err.message : err)
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
    } catch (err) {
      console.error('[chatStore] setActiveSession failed:', err instanceof Error ? err.message : err)
      set({ isLoading: false })
    }
  },

  createSession: async (type, title) => {
    if (get().isCreatingSession) return null
    set({ isCreatingSession: true })
    try {
      const session = await api.createSession(type, title)
      set((state) => ({
        sessions: [session, ...state.sessions],
        activeSessionId: session.id,
        messages: [],
        isCreatingSession: false,
      }))
      useDealStore.getState().resetDealState(session.id)
      return session
    } catch (err) {
      console.error('[chatStore] createSession failed:', err instanceof Error ? err.message : err)
      set({ isCreatingSession: false })
      throw err
    }
  },

  deleteSession: async (sessionId) => {
    try {
      await api.deleteSession(sessionId)
      set((state) => ({
        sessions: state.sessions.filter((s) => s.id !== sessionId),
        activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
        messages: state.activeSessionId === sessionId ? [] : state.messages,
      }))
    } catch (err) {
      console.error('[chatStore] deleteSession failed:', err instanceof Error ? err.message : err)
      throw err
    }
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
    set((state) => ({ messages: [...state.messages, userMessage], isSending: true, sendError: null }))

    try {
      // Get assistant response
      const assistantMessage = await api.sendMessage(activeSessionId, content, imageUri)

      // Add assistant message to chat
      set((state) => ({
        messages: [...state.messages, assistantMessage],
        isSending: false,
      }))

      // Process tool calls -> update dashboard
      if (assistantMessage.toolCalls) {
        for (const toolCall of assistantMessage.toolCalls) {
          useDealStore.getState().applyToolCall(toolCall)
        }
      }

      // Refresh sessions list to update preview
      get().loadSessions()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send message'
      console.error('[chatStore] sendMessage failed:', message)
      // Remove the optimistic user message on failure
      set((state) => ({
        messages: state.messages.filter((msg) => msg.id !== userMessage.id),
        isSending: false,
        sendError: message,
      }))
    }
  },

  clearSendError: () => {
    set({ sendError: null })
  },
}))
