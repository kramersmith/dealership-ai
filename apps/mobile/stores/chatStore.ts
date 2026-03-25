import { create } from 'zustand'
import type { BuyerContext, Message, QuickAction, Session } from '@/lib/types'
import { MAX_QUICK_ACTIONS } from '@/lib/constants'
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
  quickActions: QuickAction[]
  /** The number of assistant messages when quick actions were last updated.
   *  Used to hide stale actions after QUICK_ACTIONS_STALENESS_THRESHOLD responses without an update. */
  quickActionsMessageIndex: number
  /** True when createSession just set the activeSessionId — prevents
   *  useChat's useEffect from redundantly calling setActiveSession and
   *  wiping optimistic messages or greeting messages. */
  _sessionJustCreated: boolean

  loadSessions: () => Promise<void>
  loadMessages: (sessionId: string) => Promise<void>
  setActiveSession: (sessionId: string) => Promise<void>
  createSession: (
    type: 'buyer_chat' | 'dealer_sim',
    title?: string,
    buyerContext?: BuyerContext
  ) => Promise<Session | null>
  deleteSession: (sessionId: string) => Promise<void>
  addGreeting: (content: string) => void
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
  quickActions: [],
  quickActionsMessageIndex: 0,
  _sessionJustCreated: false,

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
    // Skip if createSession just populated this session's state — calling
    // setActiveSession would wipe optimistic messages and greeting messages.
    if (get()._sessionJustCreated && get().activeSessionId === sessionId) {
      set({ _sessionJustCreated: false })
      return
    }

    set({
      activeSessionId: sessionId,
      messages: [],
      quickActions: [],
      quickActionsMessageIndex: 0,
      isLoading: true,
      _sessionJustCreated: false,
    })
    try {
      const [messages] = await Promise.all([
        api.getMessages(sessionId),
        useDealStore.getState().loadDealState(sessionId),
      ])
      set({ messages, isLoading: false })
    } catch (err) {
      console.error(
        '[chatStore] setActiveSession failed:',
        err instanceof Error ? err.message : err
      )
      set({ isLoading: false })
    }
  },

  createSession: async (type, title, buyerContext) => {
    if (get().isCreatingSession) return null
    set({ isCreatingSession: true })
    try {
      const session = await api.createSession(type, title, buyerContext)
      set((state) => ({
        sessions: [session, ...state.sessions],
        activeSessionId: session.id,
        messages: [],
        quickActions: [],
        quickActionsMessageIndex: 0,
        isCreatingSession: false,
        _sessionJustCreated: true,
      }))
      useDealStore.getState().resetDealState(session.id, buyerContext)
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
      const isActive = get().activeSessionId === sessionId
      set((state) => ({
        sessions: state.sessions.filter((s) => s.id !== sessionId),
        activeSessionId: isActive ? null : state.activeSessionId,
        messages: isActive ? [] : state.messages,
        quickActions: isActive ? [] : state.quickActions,
        quickActionsMessageIndex: isActive ? 0 : state.quickActionsMessageIndex,
      }))
    } catch (err) {
      console.error('[chatStore] deleteSession failed:', err instanceof Error ? err.message : err)
      throw err
    }
  },

  addGreeting: (content) => {
    const { activeSessionId } = get()
    if (!activeSessionId) return
    const greetingMessage: Message = {
      id: Math.random().toString(36).substring(2),
      sessionId: activeSessionId,
      role: 'assistant',
      content,
      createdAt: new Date().toISOString(),
    }
    set((state) => ({
      messages: [...state.messages, greetingMessage],
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
    set((state) => ({
      messages: [...state.messages, userMessage],
      isSending: true,
      sendError: null,
    }))

    try {
      // Get assistant response
      const assistantMessage = await api.sendMessage(activeSessionId, content, imageUri)

      // Add assistant message to chat
      set((state) => ({
        messages: [...state.messages, assistantMessage],
        isSending: false,
      }))

      // Process tool calls -> update dashboard and quick actions
      if (assistantMessage.toolCalls) {
        for (const toolCall of assistantMessage.toolCalls) {
          if (toolCall.name === 'update_quick_actions') {
            const actions = (toolCall.args.actions as QuickAction[]) ?? []
            const validActions = actions
              .filter((action) => action.label && action.prompt)
              .slice(0, MAX_QUICK_ACTIONS)
            const assistantCount = get().messages.filter(
              (message) => message.role === 'assistant'
            ).length
            set({ quickActions: validActions, quickActionsMessageIndex: assistantCount })
          } else {
            useDealStore.getState().applyToolCall(toolCall)
          }
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
