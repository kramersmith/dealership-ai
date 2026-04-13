import { create } from 'zustand'
import type {
  BuyerContext,
  ContextPressure,
  Message,
  MessageUsage,
  QuotedCard,
  Session,
  ToolCall,
  VinAssistDecodedVehicle,
  VinAssistItem,
} from '@/lib/types'
import { api } from '@/lib/api'
import { CLIENT_ABORT_ERROR } from '@/lib/apiClient'
import { useDealStore } from './dealStore'
import { useUserSettingsStore } from './userSettingsStore'

/** Default values for compaction-related state, shared across all session-reset paths. */
const COMPACTION_RESET_SLICE = {
  contextPressure: null as ContextPressure | null,
  isCompacting: false,
  suppressContextWarningUntilUsageRefresh: false,
} as const

/** Default values for turn-cancellation state, shared across all turn-end / session-reset paths. */
const TURN_STATE_RESET_SLICE = {
  activeTurnId: null as string | null,
  isStopRequested: false,
  panelInterruptionNotice: null as { reason: string; at: string } | null,
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

const VIN_REGEX_SINGLE = /\b[A-HJ-NPR-Z0-9]{17}\b/i
const VIN_REGEX_GLOBAL = /\b[A-HJ-NPR-Z0-9]{17}\b/gi

export function normalizeVinCandidate(text: string): string | null {
  const match = text.match(VIN_REGEX_SINGLE)
  if (!match) return null
  const normalized = match[0].toUpperCase()
  return /[IOQ]/.test(normalized) ? null : normalized
}

/** All distinct valid VINs in message order (max 8). */
export function normalizeVinCandidates(text: string, maxCount = 8): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const match of text.matchAll(VIN_REGEX_GLOBAL)) {
    const normalized = match[0].toUpperCase()
    if (/[IOQ]/.test(normalized)) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
    if (out.length >= maxCount) break
  }
  return out
}

function isVinAssistTerminal(status: VinAssistItem['status']): boolean {
  return status === 'confirmed' || status === 'skipped' || status === 'rejected'
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

function redactVinForLog(vin: unknown): string | null {
  if (typeof vin !== 'string') return null
  const normalizedVin = vin.trim().toUpperCase()
  if (!normalizedVin) return null
  return normalizedVin.length <= 6
    ? normalizedVin
    : `${'*'.repeat(normalizedVin.length - 6)}${normalizedVin.slice(-6)}`
}

function sanitizeVinAssistLogData(data: Record<string, unknown>): Record<string, unknown> {
  const sanitizedData = { ...data }
  const redactedVin = redactVinForLog(sanitizedData.vin)
  if (redactedVin) {
    sanitizedData.vin = redactedVin
  } else {
    delete sanitizedData.vin
  }
  return sanitizedData
}

function trackVinAssistEvent(event: string, data: Record<string, unknown>) {
  const sanitizedData = sanitizeVinAssistLogData(data)
  if (event.endsWith('_failed')) {
    console.error(`[vin_assist] ${event}`, sanitizedData)
    return
  }
  console.info(`[vin_assist] ${event}`, sanitizedData)
}

/** True if ``id`` is a server UUID (editable branch anchor), not a client greeting placeholder. */
export function isServerMessageId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
}

/** Invokes one of the buyer-chat SSE endpoints with a single shared callback bundle. */
type BuyerTurnStreamInvoker = (callbacks: {
  onChunk: (text: string) => void
  onTurnStarted: (data: { turnId: string }) => void
  onToolResult: (toolCall: ToolCall) => void
  onTextDone: (finalText: string, usage?: MessageUsage) => void
  onInterrupted: (data: {
    text: string
    reason: string
    assistantMessageId?: string
    usage?: MessageUsage
  }) => void
  onNonFatalError: (message: string) => void
  onRetry: () => void
  onStep: () => void
  onPanelStarted: () => void
  onPanelFinished: () => void
  onPanelInterrupted: (data: { reason: string }) => void
  onCompaction: (phase: 'started' | 'done' | 'error') => void
}) => Promise<Message>

/**
 * Shared runner for the two buyer-chat stream flows (send + branch).
 *
 * Centralizes the stream-consumer bookkeeping that used to be duplicated in
 * ``sendMessage`` and ``sendBranchFromEdit``: handleTextDone/handleToolResult
 * closures, fallback finalize path, post-stream refresh, and error-path row
 * marking. Returns the finalized assistant message, or ``null`` when the turn
 * was aborted or failed.
 */
async function runBuyerTurnStream(params: {
  get: () => ChatState
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void
  activeSessionId: string
  failedMessageId: string | null
  invokeStream: BuyerTurnStreamInvoker
  onSuccess?: () => Promise<void> | void
  onTextDone?: () => void
  errorLogLabel: string
}): Promise<Message | null> {
  const {
    get,
    set,
    activeSessionId,
    failedMessageId,
    invokeStream,
    onSuccess,
    onTextDone,
    errorLogLabel,
  } = params

  try {
    set({ suppressContextWarningUntilUsageRefresh: true, isCompacting: false })
    const newResponseCount = get().aiResponseCount + 1
    let messageFinalized = false
    let clearedInFlightStatus = false

    const clearInFlightUserStatus = () => {
      if (clearedInFlightStatus || !failedMessageId) return
      clearedInFlightStatus = true
      set((state) => ({
        messages: state.messages.map((message) =>
          message.id === failedMessageId && message.status === 'sending'
            ? { ...message, status: undefined }
            : message
        ),
      }))
    }

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
          messages: [
            ...state.messages.map((message) =>
              failedMessageId && message.id === failedMessageId
                ? { ...message, status: undefined }
                : message
            ),
            msg,
          ],
          isSending: false,
          streamingText: '',
          isRetrying: false,
          isThinking: false,
          aiResponseCount: newResponseCount,
        }))
      } else {
        set((state) => ({
          messages: state.messages.map((message) =>
            failedMessageId && message.id === failedMessageId
              ? { ...message, status: undefined }
              : message
          ),
          isSending: false,
          streamingText: '',
          isRetrying: false,
          isThinking: false,
          aiResponseCount: newResponseCount,
        }))
      }
      onTextDone?.()
    }

    const handleInterrupted = (payload: {
      text: string
      reason: string
      assistantMessageId?: string
      usage?: MessageUsage
    }) => {
      if (messageFinalized) return
      messageFinalized = true
      const interruptedText = payload.text ?? ''
      if (interruptedText.trim()) {
        const msg: Message = {
          id: payload.assistantMessageId ?? Math.random().toString(36).substring(2),
          sessionId: activeSessionId,
          role: 'assistant',
          content: interruptedText,
          usage: payload.usage,
          completionStatus: 'interrupted',
          interruptedAt: new Date().toISOString(),
          interruptedReason: payload.reason,
          createdAt: new Date().toISOString(),
        }
        set((state) => ({
          messages: [
            ...state.messages.map((message) =>
              failedMessageId && message.id === failedMessageId
                ? { ...message, status: undefined }
                : message
            ),
            msg,
          ],
          isSending: false,
          streamingText: '',
          isRetrying: false,
          isThinking: false,
          isPanelAnalyzing: false,
          activeTurnId: null,
          isStopRequested: false,
          aiResponseCount: newResponseCount,
        }))
      } else {
        set((state) => ({
          messages: state.messages.map((message) =>
            failedMessageId && message.id === failedMessageId
              ? { ...message, status: undefined }
              : message
          ),
          isSending: false,
          streamingText: '',
          isRetrying: false,
          isThinking: false,
          isPanelAnalyzing: false,
          activeTurnId: null,
          isStopRequested: false,
          aiResponseCount: newResponseCount,
        }))
      }
      onTextDone?.()
    }

    // Deal-driving tool results: apiClient defers main-turn callbacks until
    // after `done` so the assistant message finalizes before the insights
    // sidebar updates. Detached follow-up can then deliver reconcile updates
    // and the final atomic panel snapshot.
    const serverUuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

    const handleToolResult = (toolCall: ToolCall) => {
      if (toolCall.name === 'update_insights_panel') {
        const assistantMessageId = toolCall.args.assistantMessageId as string | undefined
        const snapshot = get().messages
        let lastAssistantIdx = -1
        for (let i = snapshot.length - 1; i >= 0; i--) {
          const row = snapshot[i]!
          if (row.role === 'assistant' && row.sessionId === activeSessionId) {
            lastAssistantIdx = i
            break
          }
        }
        if (lastAssistantIdx === -1) {
          set((s) => ({
            insightsPanelCommitGeneration: s.insightsPanelCommitGeneration + 1,
          }))
          useDealStore.getState().applyToolCall(toolCall)
          return
        }
        const lastAssistant = snapshot[lastAssistantIdx]!
        if (
          assistantMessageId &&
          serverUuidRe.test(lastAssistant.id) &&
          lastAssistant.id !== assistantMessageId
        ) {
          return
        }
        set((state) => ({
          insightsPanelCommitGeneration: state.insightsPanelCommitGeneration + 1,
        }))
        useDealStore.getState().applyToolCall(toolCall)
        const nextCards = useDealStore.getState().dealState?.aiPanelCards ?? []
        const idToUse = assistantMessageId ?? lastAssistant.id
        set((state) => {
          const messages = [...state.messages]
          const row = messages[lastAssistantIdx]!
          messages[lastAssistantIdx] = {
            ...row,
            id: idToUse,
            panelCards: [...nextCards],
          }
          return { messages }
        })
      } else {
        useDealStore.getState().applyToolCall(toolCall)
      }
    }

    const assistantMessage = await invokeStream({
      onChunk: (text) => {
        clearInFlightUserStatus()
        set({ streamingText: text, isRetrying: false, isThinking: false })
      },
      onTurnStarted: (data) => set({ activeTurnId: data.turnId }),
      onToolResult: handleToolResult,
      onTextDone: handleTextDone,
      onInterrupted: handleInterrupted,
      onNonFatalError: (message) => set({ sendError: message }),
      onRetry: () => {
        clearInFlightUserStatus()
        set({ isRetrying: true })
      },
      onStep: () => {
        clearInFlightUserStatus()
        set({ isThinking: true })
      },
      onPanelStarted: () => {
        clearInFlightUserStatus()
        set({ panelInterruptionNotice: null })
        set({ isPanelAnalyzing: true })
      },
      onPanelFinished: () =>
        set({
          isPanelAnalyzing: false,
          activeTurnId: null,
          isStopRequested: false,
        }),
      onPanelInterrupted: (data) =>
        set({
          isPanelAnalyzing: false,
          activeTurnId: null,
          isStopRequested: false,
          panelInterruptionNotice: {
            reason: data.reason,
            at: new Date().toISOString(),
          },
        }),
      onCompaction: (phase) => {
        clearInFlightUserStatus()
        set({ isCompacting: phase === 'started' })
      },
    })

    // If no tool results arrived (rare), finalize from onload
    if (!messageFinalized) {
      set({ aiResponseCount: newResponseCount })
      if (assistantMessage.content.trim()) {
        set((state) => ({
          messages: [
            ...state.messages.map((message) =>
              failedMessageId && message.id === failedMessageId
                ? { ...message, status: undefined }
                : message
            ),
            assistantMessage,
          ],
          isSending: false,
          streamingText: '',
          isPanelAnalyzing: false,
          activeTurnId: null,
          isStopRequested: false,
        }))
      } else {
        set((state) => ({
          messages: state.messages.map((message) =>
            failedMessageId && message.id === failedMessageId
              ? { ...message, status: undefined }
              : message
          ),
          isSending: false,
          streamingText: '',
          isPanelAnalyzing: false,
          activeTurnId: null,
          isStopRequested: false,
        }))
      }
    }

    // Refresh sessions list (fire-and-forget)
    get()
      .loadSessions()
      .catch((error) => {
        console.warn(
          '[chatStore] Background session refresh failed (non-critical):',
          error instanceof Error ? error.message : error
        )
      })
    await get()
      .loadMessages(activeSessionId, { silent: true })
      .catch((error) => {
        console.warn(
          '[chatStore] Background message refresh failed (non-critical):',
          error instanceof Error ? error.message : error
        )
      })
    if (onSuccess) {
      await onSuccess()
    }
    const shouldStartInsightsFollowup =
      isServerMessageId(assistantMessage.id) &&
      useUserSettingsStore.getState().insightsUpdateMode === 'live'

    if (shouldStartInsightsFollowup) {
      void api
        .startInsightsFollowup(
          activeSessionId,
          assistantMessage.id,
          handleToolResult,
          () => {
            clearInFlightUserStatus()
            set({ panelInterruptionNotice: null, isPanelAnalyzing: true })
          },
          () => {
            set({ isPanelAnalyzing: false })
          },
          (data) =>
            set({
              isPanelAnalyzing: false,
              panelInterruptionNotice: {
                reason: data.reason,
                at: new Date().toISOString(),
              },
            }),
          (message) => {
            console.warn('[chatStore] Non-fatal insights follow-up warning:', message)
          }
        )
        .catch((error) => {
          console.warn(
            '[chatStore] Detached insights follow-up failed:',
            error instanceof Error ? error.message : error
          )
          set({
            isPanelAnalyzing: false,
            panelInterruptionNotice: {
              reason: 'error',
              at: new Date().toISOString(),
            },
          })
        })
    }
    set({
      suppressContextWarningUntilUsageRefresh: false,
      isCompacting: false,
      activeTurnId: null,
      isStopRequested: false,
    })
    return assistantMessage
  } catch (err) {
    if (err instanceof Error && err.message === CLIENT_ABORT_ERROR) {
      set({
        isSending: false,
        isRetrying: false,
        isThinking: false,
        isPanelAnalyzing: false,
        activeTurnId: null,
        isStopRequested: false,
      })
      return null
    }
    const message = err instanceof Error ? err.message : 'Failed to send message'
    console.error(`[chatStore] ${errorLogLabel} failed:`, message)
    set((state) => ({
      messages: failedMessageId
        ? state.messages.map((msg) =>
            msg.id === failedMessageId ? { ...msg, status: 'failed' as const } : msg
          )
        : state.messages,
      isSending: false,
      streamingText: '',
      isRetrying: false,
      isThinking: false,
      isPanelAnalyzing: false,
      activeTurnId: null,
      isStopRequested: false,
      ...COMPACTION_RESET_SLICE,
      sendError: message,
    }))
    return null
  }
}

type QueueMessageSource = 'typed' | 'card_reply' | 'retry'
type QueueFailureCategory = 'recoverable' | 'session_blocking' | 'validation_blocking'
type QueueItemStatus =
  | 'queued'
  | 'dispatching'
  | 'active'
  | 'paused_vin'
  | 'failed'
  | 'cancelled'
  | 'sent'

interface QueueSendPayload {
  content: string
  imageUri?: string
  quotedCard?: QuotedCard
  skipVinIntercept?: boolean
  existingUserMessageId?: string
}

interface ChatQueueItem {
  id: string
  sessionId: string
  source: QueueMessageSource
  payload: QueueSendPayload
  status: QueueItemStatus
  createdAt: string
  dispatchedAt?: string
  completedAt?: string
  optimisticMessageId?: string
  failureCategory?: QueueFailureCategory
  errorMessage?: string
}

interface ImmediateSendResult {
  outcome: 'sent' | 'paused_vin' | 'failed'
  failedMessageId: string | null
  errorMessage?: string
  failureCategory?: QueueFailureCategory
}

function classifyQueueFailure(message: string): QueueFailureCategory {
  const normalized = message.toLowerCase()
  if (
    normalized.includes('unauthorized') ||
    normalized.includes('forbidden') ||
    normalized.includes('session') ||
    normalized.includes('not found') ||
    normalized.includes('401') ||
    normalized.includes('403') ||
    normalized.includes('404')
  ) {
    return 'session_blocking'
  }
  if (
    normalized.includes('vin') ||
    normalized.includes('validation') ||
    normalized.includes('invalid')
  ) {
    return 'validation_blocking'
  }
  return 'recoverable'
}

function upsertQueueItem(
  queueBySession: Record<string, ChatQueueItem[]>,
  queueItem: ChatQueueItem
): Record<string, ChatQueueItem[]> {
  const sessionQueue = queueBySession[queueItem.sessionId] ?? []
  const nextSessionQueue = [...sessionQueue, queueItem]
  return { ...queueBySession, [queueItem.sessionId]: nextSessionQueue }
}

function mapSessionQueue(
  queueBySession: Record<string, ChatQueueItem[]>,
  sessionId: string,
  updater: (item: ChatQueueItem) => ChatQueueItem
): Record<string, ChatQueueItem[]> {
  const sessionQueue = queueBySession[sessionId] ?? []
  return {
    ...queueBySession,
    [sessionId]: sessionQueue.map((item) => updater(item)),
  }
}

interface ChatState {
  activeSessionId: string | null
  messages: Message[]
  sessions: Session[]
  isLoading: boolean
  isCreatingSession: boolean
  isSending: boolean
  sendError: string | null
  /** Increments on every AI response (including tool-only responses with no text). */
  aiResponseCount: number
  /** The accumulated text of the assistant response currently being streamed. */
  streamingText: string
  /** True when the backend is retrying a stalled/failed stream. */
  isRetrying: boolean
  /** True when the agent is processing tools between steps (no text streaming). */
  isThinking: boolean
  /** True while the backend is generating or streaming insights panel cards. */
  isPanelAnalyzing: boolean
  /** Active backend turn ID from turn_started SSE (used for safe stop + stale guards). */
  activeTurnId: string | null
  /** True while a user-initiated stop request is in flight. */
  isStopRequested: boolean
  /** Non-blocking notice when panel generation was interrupted after text done. */
  panelInterruptionNotice: { reason: string; at: string } | null
  /** Incremented on each atomic insights panel commit (batch animation + stale guard). */
  insightsPanelCommitGeneration: number
  vinAssistItems: VinAssistItem[]
  /** True when createSession just set the activeSessionId — prevents
   *  useChat's useEffect from redundantly calling setActiveSession and
   *  wiping optimistic messages or greeting messages. */
  _sessionJustCreated: boolean
  /** Stashed send params when a VIN intercept pauses the message send. */
  _pendingSend: {
    content: string
    imageUri?: string
    quotedCard?: QuotedCard
    sourceMessageId: string
  } | null
  /** Estimated model context use for the next turn (from GET messages). */
  contextPressure: ContextPressure | null
  /** Backend is summarizing older turns before streaming the reply. */
  isCompacting: boolean
  /** Hide the context-usage banner until messages refresh after a send. */
  suppressContextWarningUntilUsageRefresh: boolean
  /** When set, the composer is editing this user message for a branch send. */
  editingUserMessageId: string | null
  queueBySession: Record<string, ChatQueueItem[]>
  activeQueueItemId: string | null
  isQueueDispatching: boolean
  queueDispatchGeneration: number
  lastQueueEvent: string | null

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
    _skipVinIntercept?: boolean,
    existingUserMessageId?: string,
    source?: QueueMessageSource
  ) => Promise<void>
  _sendMessageImmediate: (
    payload: QueueSendPayload,
    queueItemId?: string,
    optimisticMessageId?: string,
    onTextDone?: () => void
  ) => Promise<ImmediateSendResult>
  _recheckQueueDispatch: () => void
  _runQueueItem: (queueItemId: string, generation: number) => Promise<void>
  removeQueuedMessage: (queueItemId: string) => void
  clearQueue: () => void
  recoverQueueStall: () => void
  /** Resume a VIN-intercepted send — called after decode/confirm/skip. */
  resumePendingSend: () => Promise<void>
  skipVinAssist: (vinAssistId: string) => void
  decodeVinAssist: (vinAssistId: string) => Promise<void>
  decodeVinAssistForVehicle: (vin: string, vehicleId?: string) => Promise<void>
  /** Decode every non-terminal assist row for this user message (sequential API calls). */
  decodeAllVinAssistForMessage: (sourceMessageId: string) => Promise<void>
  /** Confirm every decoded (unconfirmed) assist row for this message — sequential API calls. */
  confirmAllDecodedVinAssistForMessage: (sourceMessageId: string) => Promise<void>
  confirmVinAssist: (vinAssistId: string) => Promise<void>
  rejectVinAssist: (vinAssistId: string) => Promise<void>
  /** Submit a VIN from the insights panel — skips the "Decode?" prompt and auto-decodes. */
  submitVinFromPanel: (vin: string) => Promise<void>
  retrySend: (messageId: string) => Promise<void>
  stopGeneration: () => Promise<void>
  clearSendError: () => void
  startEditUserMessage: (messageId: string) => void
  cancelEditUserMessage: () => void
  sendBranchFromEdit: (content: string, imageUri?: string, quotedCard?: QuotedCard) => Promise<void>
}

export const useChatStore = create<ChatState>((set, get) => ({
  activeSessionId: null,
  messages: [],
  sessions: [],
  isLoading: false,
  isCreatingSession: false,
  isSending: false,
  sendError: null,
  aiResponseCount: 0,
  streamingText: '',
  isRetrying: false,
  isThinking: false,
  isPanelAnalyzing: false,
  ...TURN_STATE_RESET_SLICE,
  insightsPanelCommitGeneration: 0,
  vinAssistItems: [],
  _sessionJustCreated: false,
  _pendingSend: null,
  editingUserMessageId: null,
  queueBySession: {},
  activeQueueItemId: null,
  isQueueDispatching: false,
  queueDispatchGeneration: 0,
  lastQueueEvent: null,
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
      set((state) => ({
        messages,
        contextPressure,
        isLoading: opts?.silent ? state.isLoading : false,
      }))
    } catch (err) {
      console.error('[chatStore] loadMessages failed:', err instanceof Error ? err.message : err)
      if (!opts?.silent) set({ isLoading: false })
      throw err
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
      streamingText: '',
      vinAssistItems: [],
      aiResponseCount: 0,
      insightsPanelCommitGeneration: 0,
      isLoading: true,
      ...TURN_STATE_RESET_SLICE,
      _sessionJustCreated: false,
      _pendingSend: null,
      editingUserMessageId: null,
      activeQueueItemId: null,
      isQueueDispatching: false,
      ...COMPACTION_RESET_SLICE,
    })
    try {
      const [{ messages, contextPressure }] = await Promise.all([
        api.getMessages(sessionId),
        useDealStore.getState().loadDealState(sessionId),
      ])
      set({
        messages,
        contextPressure,
        isLoading: false,
      })
      get()._recheckQueueDispatch()
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
        aiResponseCount: 0,
        insightsPanelCommitGeneration: 0,
        ...TURN_STATE_RESET_SLICE,
        isCreatingSession: false,
        _sessionJustCreated: true,
        editingUserMessageId: null,
        activeQueueItemId: null,
        isQueueDispatching: false,
        ...COMPACTION_RESET_SLICE,
      }))
      useDealStore.getState().resetDealState(session.id, buyerContext)
      get()._recheckQueueDispatch()
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
        queueBySession: Object.fromEntries(
          Object.entries(state.queueBySession).filter(([key]) => key !== sessionId)
        ),
        sessions: state.sessions.filter((session) => session.id !== sessionId),
        activeSessionId: isActive ? null : state.activeSessionId,
        messages: isActive ? [] : state.messages,
        vinAssistItems: isActive ? [] : state.vinAssistItems,
        aiResponseCount: isActive ? 0 : state.aiResponseCount,
        insightsPanelCommitGeneration: isActive ? 0 : state.insightsPanelCommitGeneration,
        _pendingSend: isActive ? null : state._pendingSend,
        activeTurnId: isActive ? null : state.activeTurnId,
        isStopRequested: isActive ? false : state.isStopRequested,
        panelInterruptionNotice: isActive ? null : state.panelInterruptionNotice,
        editingUserMessageId: isActive ? null : state.editingUserMessageId,
        activeQueueItemId: isActive ? null : state.activeQueueItemId,
        isQueueDispatching: isActive ? false : state.isQueueDispatching,
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

  _sendMessageImmediate: async (payload, queueItemId, queuedMessageId, onTextDone) => {
    const { activeSessionId } = get()
    if (!activeSessionId) {
      return {
        outcome: 'failed',
        failedMessageId: null,
        errorMessage: 'No active session selected.',
        failureCategory: 'session_blocking',
      }
    }

    const { content, imageUri, quotedCard, skipVinIntercept, existingUserMessageId } = payload
    let optimisticMessageId: string | null = queuedMessageId ?? null

    if (!skipVinIntercept) {
      const detectedVins = normalizeVinCandidates(content)
      if (detectedVins.length > 0) {
        const apiContent = buildMessageContent(content, quotedCard)
        let persisted: Message
        try {
          persisted = await api.persistUserMessage(activeSessionId, apiContent, imageUri)
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to save message'
          console.error('[chatStore] persistUserMessage failed:', message)
          set({ sendError: message, isSending: false })
          return {
            outcome: 'failed',
            failedMessageId: optimisticMessageId,
            errorMessage: message,
            failureCategory: classifyQueueFailure(message),
          }
        }

        const userMessage: Message = {
          ...persisted,
          quotedCard,
        }
        set((state) => {
          let nextVinItems = [...state.vinAssistItems]
          for (const vin of detectedVins) {
            const existing = nextVinItems.find((item) => item.vin === vin)
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
                  vin,
                  sourceMessageId: userMessage.id,
                  status: 'detected',
                  updatedAt: new Date().toISOString(),
                }
            nextVinItems = nextVinItems.filter((item) => item.vin !== vin)
            nextVinItems.push(vinAssistItem)
          }
          return {
            messages: queuedMessageId
              ? state.messages.map((message) =>
                  message.id === queuedMessageId ? { ...userMessage, status: undefined } : message
                )
              : [...state.messages, userMessage],
            vinAssistItems: nextVinItems,
            isSending: false,
            streamingText: '',
            sendError: null,
            isPanelAnalyzing: false,
            ...TURN_STATE_RESET_SLICE,
            _pendingSend: { content, imageUri, quotedCard, sourceMessageId: userMessage.id },
          }
        })
        if (queueItemId) {
          set((state) => ({
            queueBySession: mapSessionQueue(state.queueBySession, activeSessionId, (item) =>
              item.id === queueItemId
                ? {
                    ...item,
                    status: 'paused_vin',
                    completedAt: new Date().toISOString(),
                    optimisticMessageId: userMessage.id,
                  }
                : item
            ),
            activeQueueItemId: null,
            isQueueDispatching: false,
            lastQueueEvent: `queue_paused_vin:${queueItemId}`,
          }))
        }
        for (const vin of detectedVins) {
          trackVinAssistEvent('detected', { sessionId: activeSessionId, vin })
        }
        return { outcome: 'paused_vin', failedMessageId: userMessage.id }
      }

      if (queuedMessageId) {
        optimisticMessageId = queuedMessageId
        set((state) => ({
          messages: state.messages.map((message) =>
            message.id === queuedMessageId ? { ...message, status: 'sending' } : message
          ),
          isSending: true,
          streamingText: '',
          sendError: null,
          isPanelAnalyzing: false,
          ...TURN_STATE_RESET_SLICE,
        }))
      } else {
        const userMessage: Message = {
          id: Math.random().toString(36).substring(2),
          sessionId: activeSessionId,
          role: 'user',
          content,
          imageUri,
          quotedCard,
          status: 'sending',
          createdAt: new Date().toISOString(),
        }
        optimisticMessageId = userMessage.id
        set((state) => ({
          messages: [...state.messages, userMessage],
          isSending: true,
          streamingText: '',
          sendError: null,
          isPanelAnalyzing: false,
          ...TURN_STATE_RESET_SLICE,
        }))
      }
    } else {
      if (existingUserMessageId) {
        optimisticMessageId = existingUserMessageId
      }
      set((state) => ({
        isSending: true,
        streamingText: '',
        sendError: null,
        isPanelAnalyzing: false,
        ...TURN_STATE_RESET_SLICE,
        vinAssistItems: existingUserMessageId
          ? state.vinAssistItems.filter((item) => item.sourceMessageId !== existingUserMessageId)
          : state.vinAssistItems,
      }))
    }

    const apiContent = buildMessageContent(content, quotedCard)
    const assistantMessage = await runBuyerTurnStream({
      get,
      set,
      activeSessionId,
      failedMessageId: optimisticMessageId,
      errorLogLabel: 'sendMessage',
      onTextDone,
      invokeStream: (cbs) =>
        api.sendMessage(
          activeSessionId,
          apiContent,
          imageUri,
          cbs.onChunk,
          cbs.onToolResult,
          cbs.onTextDone,
          cbs.onRetry,
          cbs.onStep,
          cbs.onPanelStarted,
          cbs.onPanelFinished,
          cbs.onCompaction,
          cbs.onTurnStarted,
          cbs.onInterrupted,
          cbs.onPanelInterrupted,
          skipVinIntercept ? existingUserMessageId : undefined,
          cbs.onNonFatalError
        ),
    })

    if (!assistantMessage) {
      const errorMessage = get().sendError ?? 'Failed to send message'
      return {
        outcome: 'failed',
        failedMessageId: optimisticMessageId,
        errorMessage,
        failureCategory: classifyQueueFailure(errorMessage),
      }
    }
    return { outcome: 'sent', failedMessageId: optimisticMessageId }
  },

  sendMessage: async (
    content,
    imageUri,
    quotedCard,
    _skipVinIntercept,
    existingUserMessageId,
    source
  ) => {
    const { activeSessionId } = get()
    if (!activeSessionId) return
    // Backward-compatible immediate mode for legacy/internal callers that do not
    // provide an explicit source. The queueing UX paths pass source values.
    if (!source) {
      await get()._sendMessageImmediate({
        content,
        imageUri,
        quotedCard,
        skipVinIntercept: _skipVinIntercept,
        existingUserMessageId,
      })
      // An immediate (non-queued) send may have been blocking queued items
      // behind isSending / _pendingSend. Re-check so the queue resumes.
      get()._recheckQueueDispatch()
      return
    }

    const queueItemId = Math.random().toString(36).substring(2)
    const optimisticMessageId =
      _skipVinIntercept || existingUserMessageId ? existingUserMessageId : undefined

    set((state) => ({
      sendError: null,
      queueBySession: upsertQueueItem(state.queueBySession, {
        id: queueItemId,
        sessionId: activeSessionId,
        source,
        payload: {
          content,
          imageUri,
          quotedCard,
          skipVinIntercept: _skipVinIntercept,
          existingUserMessageId,
        },
        status: 'queued',
        createdAt: new Date().toISOString(),
        optimisticMessageId,
      }),
      lastQueueEvent: `enqueue:${queueItemId}`,
    }))

    get()._recheckQueueDispatch()
  },

  _recheckQueueDispatch: () => {
    const state = get()
    const activeSessionId = state.activeSessionId
    if (!activeSessionId) return
    if (
      state.isQueueDispatching ||
      state.isSending ||
      state._pendingSend ||
      state.isPanelAnalyzing
    ) {
      return
    }
    const queue = state.queueBySession[activeSessionId] ?? []
    const nextItem = queue.find((item) => item.status === 'queued')
    if (!nextItem) return

    const generation = state.queueDispatchGeneration + 1
    set((prev) => ({
      queueDispatchGeneration: generation,
      activeQueueItemId: nextItem.id,
      isQueueDispatching: true,
      lastQueueEvent: `dispatching:${nextItem.id}`,
      queueBySession: mapSessionQueue(prev.queueBySession, activeSessionId, (item) =>
        item.id === nextItem.id
          ? { ...item, status: 'dispatching', dispatchedAt: new Date().toISOString() }
          : item
      ),
    }))
    void get()
      ._runQueueItem(nextItem.id, generation)
      .catch((error) => {
        console.error(
          '[chatStore] queue run failed:',
          error instanceof Error ? error.message : String(error)
        )
        set({
          activeQueueItemId: null,
          isQueueDispatching: false,
          lastQueueEvent: `queue_runner_error:${nextItem.id}`,
        })
      })
  },

  _runQueueItem: async (queueItemId, generation) => {
    const state = get()
    const activeSessionId = state.activeSessionId
    if (!activeSessionId) return
    if (state.queueDispatchGeneration !== generation) return

    const queueItem = (state.queueBySession[activeSessionId] ?? []).find(
      (item) => item.id === queueItemId
    )
    if (!queueItem) return

    set((prev) => ({
      queueBySession: mapSessionQueue(prev.queueBySession, activeSessionId, (item) =>
        item.id === queueItemId ? { ...item, status: 'active' } : item
      ),
      lastQueueEvent: `active:${queueItemId}`,
    }))

    let finalizedOnDone = false
    const finalizeSentOnDone = () => {
      finalizedOnDone = true
      set((prev) => ({
        queueBySession: mapSessionQueue(prev.queueBySession, activeSessionId, (item) =>
          item.id === queueItemId
            ? { ...item, status: 'sent', completedAt: new Date().toISOString() }
            : item
        ),
        activeQueueItemId: null,
        isQueueDispatching: false,
        lastQueueEvent: `sent:${queueItemId}`,
      }))
      get()._recheckQueueDispatch()
    }

    const result = await get()._sendMessageImmediate(
      queueItem.payload,
      queueItemId,
      queueItem.optimisticMessageId,
      finalizeSentOnDone
    )

    if (result.outcome === 'paused_vin') {
      set((prev) => ({
        queueBySession: mapSessionQueue(prev.queueBySession, activeSessionId, (item) =>
          item.id === queueItemId
            ? {
                ...item,
                status: 'paused_vin',
                completedAt: new Date().toISOString(),
                optimisticMessageId: result.failedMessageId ?? item.optimisticMessageId,
              }
            : item
        ),
        activeQueueItemId: null,
        isQueueDispatching: false,
        lastQueueEvent: `paused_vin:${queueItemId}`,
      }))
      return
    }

    if (result.outcome === 'failed') {
      set((prev) => ({
        queueBySession: mapSessionQueue(prev.queueBySession, activeSessionId, (item) =>
          item.id === queueItemId
            ? {
                ...item,
                status: 'failed',
                completedAt: new Date().toISOString(),
                errorMessage: result.errorMessage,
                failureCategory: result.failureCategory,
              }
            : item
        ),
        activeQueueItemId: null,
        isQueueDispatching: false,
        lastQueueEvent: `failed:${queueItemId}`,
      }))
      if (result.failureCategory !== 'session_blocking') {
        get()._recheckQueueDispatch()
      }
      return
    }

    if (!finalizedOnDone) {
      set((prev) => ({
        queueBySession: mapSessionQueue(prev.queueBySession, activeSessionId, (item) =>
          item.id === queueItemId
            ? { ...item, status: 'sent', completedAt: new Date().toISOString() }
            : item
        ),
        activeQueueItemId: null,
        isQueueDispatching: false,
        lastQueueEvent: `sent_late:${queueItemId}`,
      }))
      get()._recheckQueueDispatch()
    }
  },

  removeQueuedMessage: (queueItemId) => {
    const activeSessionId = get().activeSessionId
    if (!activeSessionId) return
    set((state) => {
      const sessionQueue = state.queueBySession[activeSessionId] ?? []
      const queueItem = sessionQueue.find((item) => item.id === queueItemId)
      if (!queueItem) return {}
      if (queueItem.status === 'active' || queueItem.status === 'dispatching') return {}
      const shouldRemoveMessage =
        !!queueItem.optimisticMessageId &&
        state.messages.some(
          (message) => message.id === queueItem.optimisticMessageId && message.status === 'queued'
        )
      return {
        queueBySession: {
          ...state.queueBySession,
          [activeSessionId]: sessionQueue.filter((item) => item.id !== queueItemId),
        },
        messages: shouldRemoveMessage
          ? state.messages.filter((message) => message.id !== queueItem.optimisticMessageId)
          : state.messages,
        lastQueueEvent: `cancelled:${queueItemId}`,
      }
    })
  },

  clearQueue: () => {
    const activeSessionId = get().activeSessionId
    if (!activeSessionId) return
    set((state) => {
      const sessionQueue = state.queueBySession[activeSessionId] ?? []
      const cancellable = sessionQueue.filter(
        (item) => item.status === 'queued' || item.status === 'paused_vin'
      )
      const cancelledMessageIds = new Set(
        cancellable
          .map((item) => item.optimisticMessageId)
          .filter(
            (messageId): messageId is string =>
              !!messageId &&
              state.messages.some(
                (message) => message.id === messageId && message.status === 'queued'
              )
          )
      )
      return {
        queueBySession: {
          ...state.queueBySession,
          [activeSessionId]: sessionQueue.filter(
            (item) => item.status !== 'queued' && item.status !== 'paused_vin'
          ),
        },
        messages: state.messages.filter((message) => !cancelledMessageIds.has(message.id)),
        lastQueueEvent: `clear_queue:${activeSessionId}`,
      }
    })
  },

  recoverQueueStall: () => {
    const state = get()
    const activeSessionId = state.activeSessionId
    if (!activeSessionId) return
    if (state.isSending || state._pendingSend) return
    if (!state.isQueueDispatching && !state.activeQueueItemId) {
      get()._recheckQueueDispatch()
      return
    }
    set((prev) => ({
      activeQueueItemId: null,
      isQueueDispatching: false,
      queueBySession: mapSessionQueue(prev.queueBySession, activeSessionId, (item) =>
        item.id === prev.activeQueueItemId && item.status !== 'sent'
          ? { ...item, status: 'queued' }
          : item
      ),
      lastQueueEvent: `recover_stall:${activeSessionId}`,
    }))
    get()._recheckQueueDispatch()
  },

  resumePendingSend: async () => {
    const pending = get()._pendingSend
    if (!pending) return
    const { activeSessionId } = get()
    if (!activeSessionId) return

    const group = get().vinAssistItems.filter(
      (item) => item.sourceMessageId === pending.sourceMessageId
    )
    const appendix: string[] = []
    for (const item of group) {
      if (item.status === 'confirmed' && item.decodedVehicle) {
        const decodedVehicle = item.decodedVehicle
        const specs = [
          decodedVehicle.year,
          decodedVehicle.make,
          decodedVehicle.model,
          decodedVehicle.trim,
        ]
          .filter(Boolean)
          .join(' ')
        appendix.push(`[VIN ${item.vin} decoded: ${specs}]`)
      } else if (item.status === 'skipped') {
        appendix.push(`[VIN ${item.vin}: continued without decode/confirm]`)
      } else if (item.status === 'rejected') {
        appendix.push(`[VIN ${item.vin}: identity not confirmed]`)
      }
    }
    let enrichedContent = pending.content
    if (appendix.length > 0) {
      enrichedContent = `${pending.content}\n\n${appendix.join('\n')}`
    }

    const sourceMessageId = pending.sourceMessageId
    set((state) => ({
      _pendingSend: null,
      queueBySession: mapSessionQueue(state.queueBySession, activeSessionId, (item) =>
        item.status === 'paused_vin' && item.optimisticMessageId === sourceMessageId
          ? { ...item, status: 'sent', completedAt: new Date().toISOString() }
          : item
      ),
    }))
    // Stream updates the persisted user row and runs the assistant (see existing_user_message_id).
    await get().sendMessage(
      enrichedContent,
      pending.imageUri,
      pending.quotedCard,
      true,
      sourceMessageId
    )
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
    const sourceMessageId = item?.sourceMessageId
    if (!sourceMessageId) return
    const pending = get()._pendingSend
    if (!pending || pending.sourceMessageId !== sourceMessageId) return
    const group = get().vinAssistItems.filter((entry) => entry.sourceMessageId === sourceMessageId)
    if (group.length === 0 || group.some((entry) => !isVinAssistTerminal(entry.status))) return
    void get()
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

  decodeAllVinAssistForMessage: async (sourceMessageId) => {
    const items = get().vinAssistItems.filter(
      (item) =>
        item.sourceMessageId === sourceMessageId &&
        (item.status === 'detected' || item.status === 'failed')
    )
    for (const item of items) {
      await get().decodeVinAssistForVehicle(item.vin, item.vehicleId)
    }
  },

  confirmAllDecodedVinAssistForMessage: async (sourceMessageId) => {
    const toConfirm = get().vinAssistItems.filter(
      (item) =>
        item.sourceMessageId === sourceMessageId &&
        item.status === 'decoded' &&
        Boolean(item.vehicleId)
    )
    for (const item of toConfirm) {
      await get().confirmVinAssist(item.id)
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
      const sourceMessageId = item.sourceMessageId
      const pending = get()._pendingSend
      if (
        sourceMessageId &&
        pending?.sourceMessageId === sourceMessageId &&
        !get()
          .vinAssistItems.filter((entry) => entry.sourceMessageId === sourceMessageId)
          .some((entry) => !isVinAssistTerminal(entry.status))
      ) {
        await get().resumePendingSend()
      }
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
      const sourceMessageId = item.sourceMessageId
      const pending = get()._pendingSend
      if (
        sourceMessageId &&
        pending?.sourceMessageId === sourceMessageId &&
        !get()
          .vinAssistItems.filter((entry) => entry.sourceMessageId === sourceMessageId)
          .some((entry) => !isVinAssistTerminal(entry.status))
      ) {
        await get().resumePendingSend()
      }
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

    let userMessage: Message
    try {
      userMessage = await api.persistUserMessage(activeSessionId, vin, undefined)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save message'
      console.error('[chatStore] submitVinFromPanel persist failed:', message)
      set({ sendError: message })
      return
    }

    const itemId = Math.random().toString(36).substring(2)
    set((state) => ({
      messages: [...state.messages, userMessage],
      _pendingSend: { content: vin, sourceMessageId: userMessage.id },
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

    await get().decodeVinAssistForVehicle(vin)
  },

  retrySend: async (messageId: string) => {
    const { messages, activeSessionId } = get()
    const failedMessage = messages.find(
      (message) => message.id === messageId && message.status === 'failed'
    )
    if (!failedMessage || !activeSessionId) return

    // Remove the failed message and re-send its content
    set((state) => ({
      messages: state.messages.filter((message) => message.id !== messageId),
      sendError: null,
    }))
    await get().sendMessage(
      failedMessage.content,
      failedMessage.imageUri,
      failedMessage.quotedCard,
      false,
      undefined,
      'retry'
    )
  },

  stopGeneration: async () => {
    const state = get()
    const activeSessionId = state.activeSessionId
    if (!activeSessionId) return
    if ((!state.isSending && !state.isPanelAnalyzing) || state.isStopRequested) return

    set({ isStopRequested: true, sendError: null })
    try {
      const response = await api.stopGeneration(activeSessionId, state.activeTurnId ?? undefined)
      if (response.status === 'not_found') {
        set({ isStopRequested: false, activeTurnId: null })
      }
    } catch (err) {
      console.error(
        '[chatStore] stopGeneration failed:',
        err instanceof Error ? err.message : String(err)
      )
      // Fallback to local stream abort if backend stop call failed.
      const aborted = api.cancelActiveStream(activeSessionId)
      if (aborted) {
        const partialText = get().streamingText.trim()
        set((current) => ({
          messages: partialText
            ? [
                ...current.messages,
                {
                  id: Math.random().toString(36).substring(2),
                  sessionId: activeSessionId,
                  role: 'assistant' as const,
                  content: partialText,
                  completionStatus: 'interrupted',
                  interruptedAt: new Date().toISOString(),
                  interruptedReason: 'user_stop',
                  createdAt: new Date().toISOString(),
                },
              ]
            : current.messages,
          isSending: false,
          streamingText: '',
          isRetrying: false,
          isThinking: false,
          isPanelAnalyzing: false,
          activeTurnId: null,
          isStopRequested: false,
          panelInterruptionNotice: current.isPanelAnalyzing
            ? { reason: 'user_stop', at: new Date().toISOString() }
            : current.panelInterruptionNotice,
        }))
        get()._recheckQueueDispatch()
        return
      }
      set({ isStopRequested: false, sendError: 'Failed to stop generation. Please try again.' })
    }
  },

  clearSendError: () => {
    set({ sendError: null })
  },

  startEditUserMessage: (messageId) => {
    if (get().isSending) return
    if (get().isPanelAnalyzing) return
    if (get()._pendingSend) return
    const activeSessionId = get().activeSessionId
    if (activeSessionId) {
      const pendingQueue = (get().queueBySession[activeSessionId] ?? []).some(
        (item) =>
          item.status === 'queued' ||
          item.status === 'dispatching' ||
          item.status === 'active' ||
          item.status === 'paused_vin'
      )
      if (pendingQueue) return
    }
    if (!isServerMessageId(messageId)) return
    const userMessage = get().messages.find(
      (message) => message.id === messageId && message.role === 'user'
    )
    if (!userMessage || userMessage.status === 'failed') return
    set({ editingUserMessageId: messageId, sendError: null })
  },

  cancelEditUserMessage: () => {
    set({ editingUserMessageId: null })
  },

  sendBranchFromEdit: async (content, imageUri, quotedCard) => {
    const { activeSessionId, editingUserMessageId, messages } = get()
    if (!activeSessionId || !editingUserMessageId) return
    if (get().isPanelAnalyzing) {
      set({
        sendError: 'Wait for the current insights refresh to finish before editing from here.',
      })
      return
    }
    const hasPendingQueue = (get().queueBySession[activeSessionId] ?? []).some(
      (item) =>
        item.status === 'queued' ||
        item.status === 'dispatching' ||
        item.status === 'active' ||
        item.status === 'paused_vin'
    )
    if (hasPendingQueue) {
      set({
        sendError:
          'Clear queued messages before editing from here. Queue and timeline forking cannot run together.',
      })
      return
    }

    if (normalizeVinCandidates(content).length > 0) {
      set({
        sendError: 'Remove VINs from this edit or send a new message to use VIN assist.',
      })
      return
    }

    const anchorId = editingUserMessageId
    const anchorIndex = messages.findIndex((message) => message.id === anchorId)
    if (anchorIndex < 0) return

    const keptIds = new Set(messages.slice(0, anchorIndex + 1).map((message) => message.id))
    const apiContent = buildMessageContent(content, quotedCard)

    // Optimistically mirror the backend's reset_session_commerce_state (ADR 0020):
    // Preserve buyerContext while clearing the structured commerce state tied to the old branch.
    // the user does not see ghost UI between the prepare phase and the next stream emit.
    const currentBuyerContext = useDealStore.getState().dealState?.buyerContext
    useDealStore.getState().resetDealState(activeSessionId, currentBuyerContext)

    set((state) => ({
      messages: state.messages
        .slice(0, anchorIndex + 1)
        .map((message) =>
          message.id === anchorId ? { ...message, content, imageUri, quotedCard } : message
        ),
      vinAssistItems: state.vinAssistItems.filter((item) => keptIds.has(item.sourceMessageId)),
      isSending: true,
      streamingText: '',
      sendError: null,
      isPanelAnalyzing: false,
      ...TURN_STATE_RESET_SLICE,
      editingUserMessageId: null,
    }))

    const assistantMessage = await runBuyerTurnStream({
      get,
      set,
      activeSessionId,
      failedMessageId: anchorId,
      errorLogLabel: 'sendBranchFromEdit',
      invokeStream: (cbs) =>
        api.branchFromUserMessage(
          activeSessionId,
          anchorId,
          apiContent,
          imageUri,
          cbs.onChunk,
          cbs.onToolResult,
          cbs.onTextDone,
          cbs.onRetry,
          cbs.onStep,
          cbs.onPanelStarted,
          cbs.onPanelFinished,
          cbs.onCompaction,
          cbs.onTurnStarted,
          cbs.onInterrupted,
          cbs.onPanelInterrupted,
          cbs.onNonFatalError
        ),
      onSuccess: async () => {
        await useDealStore
          .getState()
          .loadDealState(activeSessionId, { strict: true })
          .catch((error) => {
            console.warn(
              '[chatStore] Branch deal refresh failed (non-critical):',
              error instanceof Error ? error.message : error
            )
          })
      },
    })
    if (!assistantMessage) {
      let historyRefreshFailed = false
      let dealRefreshFailed = false
      await Promise.all([
        get()
          .loadMessages(activeSessionId, { silent: true })
          .catch((error) => {
            historyRefreshFailed = true
            console.warn(
              '[chatStore] Branch history refresh failed after send error:',
              error instanceof Error ? error.message : error
            )
          }),
        useDealStore
          .getState()
          .loadDealState(activeSessionId, { strict: true })
          .catch((error) => {
            dealRefreshFailed = true
            console.warn(
              '[chatStore] Branch deal refresh failed after send error:',
              error instanceof Error ? error.message : error
            )
          }),
      ])
      if (historyRefreshFailed || dealRefreshFailed) {
        const staleViewMessage =
          historyRefreshFailed && dealRefreshFailed
            ? 'We also could not refresh the chat or deal state, so this view may be out of date.'
            : historyRefreshFailed
              ? 'We also could not refresh the chat history, so this view may be out of date.'
              : 'We also could not refresh the deal state, so this view may be out of date.'
        set((state) => ({
          sendError: state.sendError ? `${state.sendError} ${staleViewMessage}` : staleViewMessage,
        }))
      }
    }
  },
}))
