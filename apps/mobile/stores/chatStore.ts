import { create } from 'zustand'
import type {
  BuyerContext,
  ContextPressure,
  Message,
  MessageUsage,
  QuickAction,
  QuotedCard,
  Session,
  ToolCall,
  VinAssistDecodedVehicle,
  VinAssistItem,
} from '@/lib/types'
import { MAX_QUICK_ACTIONS } from '@/lib/constants'
import { api } from '@/lib/api'
import { useDealStore } from './dealStore'

/** Default values for compaction-related state, shared across all session-reset paths. */
const COMPACTION_RESET_SLICE = {
  contextPressure: null as ContextPressure | null,
  isCompacting: false,
  suppressContextWarningUntilUsageRefresh: false,
} as const

/** Build the message content sent to the backend, optionally prefixing with quoted card context. */
function buildMessageContent(text: string, quotedCard?: QuotedCard): string {
  if (!quotedCard) return text
  try {
    const cardSummary = JSON.stringify(quotedCard.content)
    return `[Referring to "${quotedCard.title}" (${quotedCard.kind} card): ${cardSummary}]\n\n${text}`
  } catch {
    return `[Referring to "${quotedCard.title}" (${quotedCard.kind} card)]\n\n${text}`
  }
}

const VIN_REGEX = /\b[A-HJ-NPR-Z0-9]{17}\b/i

export function normalizeVinCandidate(text: string): string | null {
  const match = text.match(VIN_REGEX)
  if (!match) return null
  const normalized = match[0].toUpperCase()
  return /[IOQ]/.test(normalized) ? null : normalized
}

function buildDecodedVehicle(decoded: {
  year?: number
  make?: string
  model?: string
  trim?: string
}): VinAssistDecodedVehicle {
  return {
    year: decoded.year,
    make: decoded.make,
    model: decoded.model,
    trim: decoded.trim,
    partial: !decoded.year || !decoded.make || !decoded.model || !decoded.trim,
  }
}

function trackVinAssistEvent(event: string, data: Record<string, unknown>) {
  console.info(`[vin_assist] ${event}`, data)
}

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
  /** True when the backend is retrying a stalled/failed stream. */
  isRetrying: boolean
  /** True when the agent is processing tools between steps (no text streaming). */
  isThinking: boolean
  /** True while the backend is generating or streaming insights panel cards. */
  isPanelAnalyzing: boolean
  vinAssistItems: VinAssistItem[]
  /** True when createSession just set the activeSessionId — prevents
   *  useChat's useEffect from redundantly calling setActiveSession and
   *  wiping optimistic messages or greeting messages. */
  _sessionJustCreated: boolean
  /** Stashed send params when a VIN intercept pauses the message send. */
  _pendingSend: { content: string; imageUri?: string; quotedCard?: QuotedCard } | null
  /** Estimated model context use for the next turn (from GET messages). */
  contextPressure: ContextPressure | null
  /** Backend is summarizing older turns before streaming the reply. */
  isCompacting: boolean
  /** Hide the context-usage banner until messages refresh after a send. */
  suppressContextWarningUntilUsageRefresh: boolean

  loadSessions: () => Promise<void>
  searchSessions: (query: string) => Promise<Session[]>
  loadMessages: (sessionId: string, opts?: { silent?: boolean }) => Promise<void>
  setActiveSession: (sessionId: string) => Promise<void>
  createSession: (
    type: 'buyer_chat' | 'dealer_sim',
    title?: string,
    buyerContext?: BuyerContext
  ) => Promise<Session | null>
  deleteSession: (sessionId: string) => Promise<void>
  addGreeting: (content: string) => void
  sendMessage: (
    content: string,
    imageUri?: string,
    quotedCard?: QuotedCard,
    _skipVinIntercept?: boolean
  ) => Promise<void>
  /** Resume a VIN-intercepted send — called after decode/confirm/skip. */
  resumePendingSend: () => Promise<void>
  skipVinAssist: (vinAssistId: string) => void
  decodeVinAssist: (vinAssistId: string) => Promise<void>
  decodeVinAssistForVehicle: (vin: string, vehicleId?: string) => Promise<void>
  confirmVinAssist: (vinAssistId: string) => Promise<void>
  rejectVinAssist: (vinAssistId: string) => Promise<void>
  /** Submit a VIN from the insights panel — skips the "Decode?" prompt and auto-decodes. */
  submitVinFromPanel: (vin: string) => Promise<void>
  retrySend: (messageId: string) => Promise<void>
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
  isRetrying: false,
  isThinking: false,
  isPanelAnalyzing: false,
  vinAssistItems: [],
  _sessionJustCreated: false,
  _pendingSend: null,
  ...COMPACTION_RESET_SLICE,

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

  loadMessages: async (sessionId, opts) => {
    if (!opts?.silent) set({ isLoading: true })
    try {
      const { messages, contextPressure } = await api.getMessages(sessionId)
      set((s) => ({
        messages,
        contextPressure,
        isLoading: opts?.silent ? s.isLoading : false,
      }))
    } catch (err) {
      console.error('[chatStore] loadMessages failed:', err instanceof Error ? err.message : err)
      if (!opts?.silent) set({ isLoading: false })
    }
  },

  setActiveSession: async (sessionId) => {
    // Skip if already on this session — prevents redundant calls from
    // React effects that fire multiple times (strict mode, re-renders)
    // from wiping optimistic messages, VIN assist items, or pending sends.
    if (get().activeSessionId === sessionId) {
      if (get()._sessionJustCreated) {
        set({ _sessionJustCreated: false })
      }
      return
    }
    set({
      activeSessionId: sessionId,
      messages: [],
      vinAssistItems: [],
      quickActions: [],
      aiResponseCount: 0,
      quickActionsUpdatedAtResponse: 0,
      isLoading: true,
      _sessionJustCreated: false,
      _pendingSend: null,
      ...COMPACTION_RESET_SLICE,
    })
    try {
      const [{ messages, contextPressure }] = await Promise.all([
        api.getMessages(sessionId),
        useDealStore.getState().loadDealState(sessionId),
      ])
      set({ messages, contextPressure, isLoading: false })
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
        vinAssistItems: [],
        quickActions: [],
        aiResponseCount: 0,
        quickActionsUpdatedAtResponse: 0,
        isCreatingSession: false,
        _sessionJustCreated: true,
        ...COMPACTION_RESET_SLICE,
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
        vinAssistItems: isActive ? [] : state.vinAssistItems,
        quickActions: isActive ? [] : state.quickActions,
        aiResponseCount: isActive ? 0 : state.aiResponseCount,
        quickActionsUpdatedAtResponse: isActive ? 0 : state.quickActionsUpdatedAtResponse,
        _pendingSend: isActive ? null : state._pendingSend,
        contextPressure: isActive ? null : state.contextPressure,
        isCompacting: isActive ? false : state.isCompacting,
        suppressContextWarningUntilUsageRefresh: isActive
          ? false
          : state.suppressContextWarningUntilUsageRefresh,
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

  sendMessage: async (content, imageUri, quotedCard, _skipVinIntercept) => {
    const { activeSessionId } = get()
    if (!activeSessionId) return

    // Track the optimistic message ID for error rollback
    let optimisticMessageId: string | null = null

    if (!_skipVinIntercept) {
      // Optimistically add user message
      const userMessage: Message = {
        id: Math.random().toString(36).substring(2),
        sessionId: activeSessionId,
        role: 'user',
        content,
        imageUri,
        quotedCard,
        createdAt: new Date().toISOString(),
      }
      optimisticMessageId = userMessage.id
      const detectedVin = normalizeVinCandidate(content)
      set((state) => ({
        messages: [...state.messages, userMessage],
        vinAssistItems: detectedVin
          ? (() => {
              const existing = state.vinAssistItems.find((item) => item.vin === detectedVin)
              const vinAssistItem: VinAssistItem = existing
                ? {
                    ...existing,
                    sourceMessageId: userMessage.id,
                    status: 'detected',
                    error: null,
                    updatedAt: new Date().toISOString(),
                  }
                : {
                    id: Math.random().toString(36).substring(2),
                    sessionId: activeSessionId,
                    vin: detectedVin,
                    sourceMessageId: userMessage.id,
                    status: 'detected',
                    updatedAt: new Date().toISOString(),
                  }
              return [
                ...state.vinAssistItems.filter((item) => item.vin !== detectedVin),
                vinAssistItem,
              ]
            })()
          : state.vinAssistItems,
        isSending: true,
        streamingText: '',
        sendError: null,
        isPanelAnalyzing: false,
      }))
      if (detectedVin) {
        trackVinAssistEvent('detected', { sessionId: activeSessionId, vin: detectedVin })
        // Pause the send — stash params and wait for user to decode or skip
        set({ _pendingSend: { content, imageUri, quotedCard }, isSending: false })
        return
      }
    } else {
      // Resume path — message already in chat, just set sending state
      set({ isSending: true, streamingText: '', sendError: null })
      set({ isPanelAnalyzing: false })
    }

    try {
      set({ suppressContextWarningUntilUsageRefresh: true, isCompacting: false })
      // Track response count for staleness
      const newResponseCount = get().aiResponseCount + 1
      let messageFinalized = false

      // Finalize the assistant message as soon as text streaming completes
      // (the "done" SSE event), so the StreamingBubble is replaced by a
      // permanent ChatBubble immediately — not seconds later on the first
      // tool_result.
      const handleTextDone = (finalText: string, usage?: MessageUsage) => {
        if (messageFinalized) return
        messageFinalized = true
        if (finalText.trim()) {
          const msg: Message = {
            id: Math.random().toString(36).substring(2),
            sessionId: activeSessionId,
            role: 'assistant',
            content: finalText,
            usage,
            createdAt: new Date().toISOString(),
          }
          set((state) => ({
            messages: [...state.messages, msg],
            isSending: false,
            streamingText: '',
            isRetrying: false,
            isThinking: false,
            aiResponseCount: newResponseCount,
          }))
        } else {
          set({
            isSending: false,
            streamingText: '',
            isRetrying: false,
            isThinking: false,
            aiResponseCount: newResponseCount,
          })
        }
      }

      // Deal-driving tool results: apiClient defers callbacks until after the
      // `done` event so the assistant message finalizes before the insights
      // sidebar updates. Panel card events still stream after `done`.
      const handleToolResult = (toolCall: ToolCall) => {
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
      const apiContent = buildMessageContent(content, quotedCard)
      const assistantMessage = await api.sendMessage(
        activeSessionId,
        apiContent,
        imageUri,
        (text) => set({ streamingText: text, isRetrying: false, isThinking: false }),
        handleToolResult,
        handleTextDone,
        () => set({ isRetrying: true }),
        () => set({ isThinking: true }),
        () => set({ isPanelAnalyzing: true }),
        () => set({ isPanelAnalyzing: false }),
        (phase) => {
          set({ isCompacting: phase === 'started' })
        }
      )

      // If no tool results arrived (rare), finalize from onload
      if (!messageFinalized) {
        set({ aiResponseCount: newResponseCount })
        if (assistantMessage.content.trim()) {
          set((state) => ({
            messages: [...state.messages, assistantMessage],
            isSending: false,
            streamingText: '',
            isPanelAnalyzing: false,
          }))
        } else {
          set({ isSending: false, streamingText: '', isPanelAnalyzing: false })
        }
      }

      // Refresh sessions list (fire-and-forget)
      get()
        .loadSessions()
        .catch(() => {})
      await get()
        .loadMessages(activeSessionId, { silent: true })
        .catch(() => {})
      set({ suppressContextWarningUntilUsageRefresh: false, isCompacting: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send message'
      console.error('[chatStore] sendMessage failed:', message)
      // Keep the optimistic user message but mark it as failed
      set((state) => ({
        messages: optimisticMessageId
          ? state.messages.map((msg) =>
              msg.id === optimisticMessageId ? { ...msg, status: 'failed' as const } : msg
            )
          : state.messages,
        isSending: false,
        streamingText: '',
        isRetrying: false,
        isThinking: false,
        isPanelAnalyzing: false,
        ...COMPACTION_RESET_SLICE,
        sendError: message,
      }))
    }
  },

  resumePendingSend: async () => {
    const pending = get()._pendingSend
    if (!pending) return
    const { activeSessionId } = get()
    if (!activeSessionId) return

    // Check if a VIN was confirmed — if so, append decoded vehicle info to the message
    const confirmedItem = get().vinAssistItems.find(
      (item) => item.status === 'confirmed' && item.decodedVehicle
    )
    let enrichedContent = pending.content
    if (confirmedItem?.decodedVehicle) {
      const decodedVehicle = confirmedItem.decodedVehicle
      const specs = [
        decodedVehicle.year,
        decodedVehicle.make,
        decodedVehicle.model,
        decodedVehicle.trim,
      ]
        .filter(Boolean)
        .join(' ')
      enrichedContent = `${pending.content}\n\n[VIN ${confirmedItem.vin} decoded: ${specs}]`
    }

    set({ _pendingSend: null })
    // Re-invoke sendMessage with _skipVinIntercept=true to skip message adding
    // and VIN detection (message is already in chat from the initial send).
    await get().sendMessage(enrichedContent, pending.imageUri, pending.quotedCard, true)
  },

  skipVinAssist: (vinAssistId) => {
    const item = get().vinAssistItems.find((entry) => entry.id === vinAssistId)
    set((state) => ({
      vinAssistItems: state.vinAssistItems.map((entry) =>
        entry.id === vinAssistId
          ? { ...entry, status: 'skipped', error: null, updatedAt: new Date().toISOString() }
          : entry
      ),
    }))
    if (item) {
      trackVinAssistEvent('skipped', { sessionId: item.sessionId, vin: item.vin })
    }
    // Resume the paused send if one exists — catch to avoid unhandled rejection
    get()
      .resumePendingSend()
      .catch((err) => {
        console.error(
          '[chatStore] resumePendingSend after skip failed:',
          err instanceof Error ? err.message : err
        )
      })
  },

  decodeVinAssist: async (vinAssistId) => {
    const item = get().vinAssistItems.find((entry) => entry.id === vinAssistId)
    if (!item) return
    await get().decodeVinAssistForVehicle(item.vin, item.vehicleId)
  },

  decodeVinAssistForVehicle: async (vin, vehicleId) => {
    const { activeSessionId } = get()
    if (!activeSessionId) return
    const existing = get().vinAssistItems.find((item) => item.vin === vin)
    const itemId = existing?.id ?? Math.random().toString(36).substring(2)
    set((state) => ({
      vinAssistItems: [
        ...state.vinAssistItems.filter((item) => item.vin !== vin),
        {
          id: itemId,
          sessionId: activeSessionId,
          vin,
          sourceMessageId: existing?.sourceMessageId ?? '',
          vehicleId: vehicleId ?? existing?.vehicleId,
          status: 'decoding',
          error: null,
          decodedVehicle: existing?.decodedVehicle,
          updatedAt: new Date().toISOString(),
        },
      ],
    }))
    trackVinAssistEvent('decode_started', { sessionId: activeSessionId, vin })

    try {
      const ensuredVehicle = vehicleId
        ? (useDealStore
            .getState()
            .dealState?.vehicles.find((vehicle) => vehicle.id === vehicleId) ??
          (await api.upsertVehicleFromVin(activeSessionId, vin)))
        : await api.upsertVehicleFromVin(activeSessionId, vin)
      useDealStore.getState().setVehicleIntelligenceLoading(ensuredVehicle.id, 'decode')
      const intelligence = await api.decodeVehicleVin(activeSessionId, ensuredVehicle.id, vin)
      await useDealStore.getState().loadDealState(activeSessionId)
      const decodedData = intelligence.decode
      if (!decodedData) {
        throw new Error('VIN decode returned no vehicle details')
      }
      set((state) => ({
        vinAssistItems: state.vinAssistItems.map((entry) =>
          entry.vin === vin
            ? {
                ...entry,
                vehicleId: ensuredVehicle.id,
                status: 'decoded',
                decodedVehicle: buildDecodedVehicle(decodedData),
                error: null,
                updatedAt: new Date().toISOString(),
              }
            : entry
        ),
      }))
      trackVinAssistEvent('decode_succeeded', { sessionId: activeSessionId, vin })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'VIN decode failed'
      set((state) => ({
        vinAssistItems: state.vinAssistItems.map((entry) =>
          entry.vin === vin
            ? { ...entry, status: 'failed', error: message, updatedAt: new Date().toISOString() }
            : entry
        ),
      }))
      trackVinAssistEvent('decode_failed', { sessionId: activeSessionId, vin, message })
    }
  },

  confirmVinAssist: async (vinAssistId) => {
    const { activeSessionId } = get()
    const item = get().vinAssistItems.find((entry) => entry.id === vinAssistId)
    if (!activeSessionId || !item?.vehicleId) return
    try {
      await api.confirmVehicleIdentity(activeSessionId, item.vehicleId, 'confirmed')
      await Promise.all([
        useDealStore.getState().loadDealState(activeSessionId),
        get().loadSessions(),
      ])
      set((state) => ({
        vinAssistItems: state.vinAssistItems.map((entry) =>
          entry.id === vinAssistId
            ? { ...entry, status: 'confirmed', error: null, updatedAt: new Date().toISOString() }
            : entry
        ),
      }))
      trackVinAssistEvent('decode_confirmed', { sessionId: activeSessionId, vin: item.vin })
      // Resume the paused send if one exists — with decoded vehicle info appended
      await get().resumePendingSend()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to confirm vehicle identity'
      console.error('[chatStore] confirmVinAssist failed:', message)
      set((state) => ({
        vinAssistItems: state.vinAssistItems.map((entry) =>
          entry.id === vinAssistId
            ? { ...entry, status: 'failed', error: message, updatedAt: new Date().toISOString() }
            : entry
        ),
      }))
      trackVinAssistEvent('confirm_failed', { sessionId: activeSessionId, vin: item.vin, message })
    }
  },

  rejectVinAssist: async (vinAssistId) => {
    const { activeSessionId } = get()
    const item = get().vinAssistItems.find((entry) => entry.id === vinAssistId)
    if (!activeSessionId || !item?.vehicleId) return
    try {
      await api.confirmVehicleIdentity(activeSessionId, item.vehicleId, 'rejected')
      await Promise.all([
        useDealStore.getState().loadDealState(activeSessionId),
        get().loadSessions(),
      ])
      set((state) => ({
        vinAssistItems: state.vinAssistItems.map((entry) =>
          entry.id === vinAssistId
            ? { ...entry, status: 'rejected', updatedAt: new Date().toISOString() }
            : entry
        ),
      }))
      trackVinAssistEvent('decode_rejected', { sessionId: activeSessionId, vin: item.vin })
      // Resume the paused send if one exists — without decoded info
      await get().resumePendingSend()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reject vehicle identity'
      console.error('[chatStore] rejectVinAssist failed:', message)
      set((state) => ({
        vinAssistItems: state.vinAssistItems.map((entry) =>
          entry.id === vinAssistId
            ? { ...entry, status: 'failed', error: message, updatedAt: new Date().toISOString() }
            : entry
        ),
      }))
      trackVinAssistEvent('reject_failed', { sessionId: activeSessionId, vin: item.vin, message })
    }
  },

  submitVinFromPanel: async (vin) => {
    const { activeSessionId } = get()
    if (!activeSessionId) return

    // Add the VIN as a user message in chat
    const userMessage: Message = {
      id: Math.random().toString(36).substring(2),
      sessionId: activeSessionId,
      role: 'user',
      content: vin,
      createdAt: new Date().toISOString(),
    }

    // Stash the pending send and create a vinAssistItem in 'decoding' status
    // (skipping the 'detected' step entirely)
    const itemId = Math.random().toString(36).substring(2)
    set((state) => ({
      messages: [...state.messages, userMessage],
      _pendingSend: { content: vin },
      vinAssistItems: [
        ...state.vinAssistItems.filter((item) => item.vin !== vin),
        {
          id: itemId,
          sessionId: activeSessionId,
          vin,
          sourceMessageId: userMessage.id,
          status: 'decoding' as const,
          updatedAt: new Date().toISOString(),
        },
      ],
    }))

    // Auto-trigger decode — this updates the vinAssistItem to 'decoded'
    // and the VinAssistCard in chat will show the confirm step
    await get().decodeVinAssistForVehicle(vin)
  },

  retrySend: async (messageId: string) => {
    const { messages, activeSessionId } = get()
    const failedMessage = messages.find((m) => m.id === messageId && m.status === 'failed')
    if (!failedMessage || !activeSessionId) return

    // Remove the failed message and re-send its content
    set((state) => ({
      messages: state.messages.filter((m) => m.id !== messageId),
      sendError: null,
    }))
    await get().sendMessage(failedMessage.content, failedMessage.imageUri, failedMessage.quotedCard)
  },

  clearSendError: () => {
    set({ sendError: null })
  },
}))
