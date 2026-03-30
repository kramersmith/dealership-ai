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

  const timerStartedAt = useDealStore((s) => s.dealState?.timerStartedAt ?? null)
  const startTimer = useDealStore((s) => s.startTimer)

  useEffect(() => {
    if (sessionId) {
      setActiveSession(sessionId)
    }
  }, [sessionId, setActiveSession])

  const send = useCallback(
    async (content: string, imageUri?: string) => {
      await sendMessage(content, imageUri)

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

  const handleQuickAction = useCallback(
    (prompt: string) => {
      if (prompt) {
        sendMessage(prompt)
      }
    },
    [sendMessage]
  )

  return {
    messages,
    isSending,
    isLoading,
    streamingText,
    send,
    handleQuickAction,
  }
}
