import { create } from 'zustand'
import type { BuyerContext, Message, QuickAction, Session, ToolCall } from '@/lib/types'
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
  /** Increments on every AI response (including tool-only responses with no text). */
  aiResponseCount: number
  /** The aiResponseCount when quick actions were last updated. */
  quickActionsUpdatedAtResponse: number
  /** The accumulated text of the assistant response currently being streamed. */
  streamingText: string
  /** True when createSession just set the activeSessionId — prevents
   *  useChat's useEffect from redundantly calling setActiveSession and
   *  wiping optimistic messages or greeting messages. */
  _sessionJustCreated: boolean

  loadSessions: () => Promise<void>
  searchSessions: (query: string) => Promise<Session[]>
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
  aiResponseCount: 0,
  quickActionsUpdatedAtResponse: 0,
  streamingText: '',
  _sessionJustCreated: false,

  loadSessions: async () => {
    // Only show loading state if we have no sessions yet (initial load).
    // Background refreshes (after sending a message) should not trigger
    // loading indicators or cause re-renders that disrupt the chat input.
    const hasExistingSessions = get().sessions.length > 0
    if (!hasExistingSessions) set({ isLoading: true })
    try {
      const sessions = await api.getSessions()
      set({ sessions, isLoading: false })
    } catch (err) {
      console.error('[chatStore] loadSessions failed:', err instanceof Error ? err.message : err)
      if (!hasExistingSessions) set({ isLoading: false })
      throw err
    }
  },

  searchSessions: async (query) => {
    try {
      return await api.searchSessions(query)
    } catch (err) {
      console.error('[chatStore] searchSessions failed:', err instanceof Error ? err.message : err)
      throw err
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
      aiResponseCount: 0,
      quickActionsUpdatedAtResponse: 0,
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
        aiResponseCount: 0,
        quickActionsUpdatedAtResponse: 0,
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
        aiResponseCount: isActive ? 0 : state.aiResponseCount,
        quickActionsUpdatedAtResponse: isActive ? 0 : state.quickActionsUpdatedAtResponse,
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
      streamingText: '',
      sendError: null,
    }))

    try {
      // Track response count for staleness
      const newResponseCount = get().aiResponseCount + 1
      let messageFinalized = false

      // Finalize the assistant message as soon as text streaming completes
      // (the "done" SSE event), so the StreamingBubble is replaced by a
      // permanent ChatBubble immediately — not seconds later on the first
      // tool_result.
      const handleTextDone = (finalText: string) => {
        if (messageFinalized) return
        messageFinalized = true
        if (finalText.trim()) {
          const msg: Message = {
            id: Math.random().toString(36).substring(2),
            sessionId: activeSessionId,
            role: 'assistant',
            content: finalText,
            createdAt: new Date().toISOString(),
          }
          set((state) => ({
            messages: [...state.messages, msg],
            isSending: false,
            streamingText: '',
            aiResponseCount: newResponseCount,
          }))
        } else {
          set({ isSending: false, streamingText: '', aiResponseCount: newResponseCount })
        }
      }

      // Process tool results incrementally as they arrive from SSE
      const handleToolResult = (toolCall: ToolCall) => {
        // Fallback finalization in case done event didn't fire
        if (!messageFinalized) {
          messageFinalized = true
          const currentStreamingText = get().streamingText
          if (currentStreamingText.trim()) {
            const msg: Message = {
              id: Math.random().toString(36).substring(2),
              sessionId: activeSessionId,
              role: 'assistant',
              content: currentStreamingText,
              createdAt: new Date().toISOString(),
            }
            set((state) => ({
              messages: [...state.messages, msg],
              isSending: false,
              streamingText: '',
              aiResponseCount: newResponseCount,
            }))
          }
        }

        // Route tool call
        if (toolCall.name === 'update_quick_actions') {
          const actions = (toolCall.args.actions as QuickAction[]) ?? []
          const validActions = actions
            .filter((action) => action.label && action.prompt)
            .slice(0, MAX_QUICK_ACTIONS)
          set({ quickActions: validActions, quickActionsUpdatedAtResponse: newResponseCount })
        } else {
          useDealStore.getState().applyToolCall(toolCall)
        }
      }

      // Stream text chunks to the store for live display
      const assistantMessage = await api.sendMessage(
        activeSessionId,
        content,
        imageUri,
        (text) => set({ streamingText: text }),
        handleToolResult,
        handleTextDone
      )

      // If no tool results arrived (rare), finalize from onload
      if (!messageFinalized) {
        set({ aiResponseCount: newResponseCount })
        if (assistantMessage.content.trim()) {
          set((state) => ({
            messages: [...state.messages, assistantMessage],
            isSending: false,
            streamingText: '',
          }))
        } else {
          set({ isSending: false, streamingText: '' })
        }
      }

      // Refresh sessions list (fire-and-forget)
      get()
        .loadSessions()
        .catch(() => {})
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send message'
      console.error('[chatStore] sendMessage failed:', message)
      // Remove the optimistic user message on failure
      set((state) => ({
        messages: state.messages.filter((msg) => msg.id !== userMessage.id),
        isSending: false,
        streamingText: '',
        sendError: message,
      }))
    }
  },

  clearSendError: () => {
    set({ sendError: null })
  },
}))
