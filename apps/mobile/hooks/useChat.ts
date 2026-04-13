import { useEffect, useCallback } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useDealStore } from '@/stores/dealStore'

export function useChat(sessionId: string | null) {
  // Use individual selectors to avoid re-rendering on unrelated store changes
  const messages = useChatStore((s) => s.messages)
  const isSending = useChatStore((s) => s.isSending)
  const isLoading = useChatStore((s) => s.isLoading)
  const streamingText = useChatStore((s) => s.streamingText)
  const setActiveSession = useChatStore((s) => s.setActiveSession)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const clearQueue = useChatStore((s) => s.clearQueue)
  const stopGeneration = useChatStore((s) => s.stopGeneration)
  const isStopRequested = useChatStore((s) => s.isStopRequested)
  const isPanelAnalyzing = useChatStore((s) => s.isPanelAnalyzing)
  const panelInterruptionNotice = useChatStore((s) => s.panelInterruptionNotice)
  const recoverQueueStall = useChatStore((s) => s.recoverQueueStall)
  const removeQueuedMessage = useChatStore((s) => s.removeQueuedMessage)
  const queueBySession = useChatStore((s) => s.queueBySession)
  const activeQueueItemId = useChatStore((s) => s.activeQueueItemId)
  const isQueueDispatching = useChatStore((s) => s.isQueueDispatching)
  const isPendingVinIntercept = useChatStore((s) => s._pendingSend != null)

  const timerStartedAt = useDealStore((s) => s.dealState?.timerStartedAt ?? null)
  const startTimer = useDealStore((s) => s.startTimer)

  useEffect(() => {
    if (sessionId) {
      setActiveSession(sessionId)
    }
  }, [sessionId, setActiveSession])

  const send = useCallback(
    async (content: string, imageUri?: string) => {
      await sendMessage(content, imageUri, undefined, false, undefined, 'typed')

      // Auto-start timer when user mentions being at the dealership
      const lower = content.toLowerCase()
      if (
        timerStartedAt === null &&
        (lower.includes("i'm here") ||
          lower.includes('arrived') ||
          lower.includes('at the dealer') ||
          lower.includes('just got here'))
      ) {
        startTimer()
      }
    },
    [sendMessage, timerStartedAt, startTimer]
  )

  const activeSessionQueue = sessionId ? (queueBySession[sessionId] ?? []) : []
  const pendingQueueItems = activeSessionQueue.filter(
    (item) =>
      item.status === 'queued' ||
      item.status === 'dispatching' ||
      item.status === 'active' ||
      item.status === 'paused_vin'
  )
  const queuedCount = pendingQueueItems.filter((item) => item.status === 'queued').length
  const firstQueuedPreview =
    pendingQueueItems.find((item) => item.status === 'queued')?.payload.content ?? null
  const canBranchEdit =
    !isSending && !isPanelAnalyzing && !isPendingVinIntercept && pendingQueueItems.length === 0

  return {
    messages,
    isSending,
    isLoading,
    streamingText,
    isStopRequested,
    isPanelAnalyzing,
    panelInterruptionNotice,
    queuedCount,
    firstQueuedPreview,
    pendingQueueItems,
    activeQueueItemId,
    isQueueDispatching,
    canBranchEdit,
    send,
    stopGeneration,
    clearQueue,
    recoverQueueStall,
    removeQueuedMessage,
  }
}
