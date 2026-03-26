import { useEffect } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useDealStore } from '@/stores/dealStore'

export function useChat(sessionId: string | null) {
  const { messages, isSending, isLoading, streamingText, setActiveSession, sendMessage } =
    useChatStore()

  const dealState = useDealStore((s) => s.dealState)
  const toggleChecklistItem = useDealStore((s) => s.toggleChecklistItem)
  const startTimer = useDealStore((s) => s.startTimer)

  useEffect(() => {
    if (sessionId) {
      setActiveSession(sessionId)
    }
  }, [sessionId, setActiveSession])

  const send = async (content: string, imageUri?: string) => {
    await sendMessage(content, imageUri)

    // Auto-start timer when user mentions being at the dealership
    const lower = content.toLowerCase()
    if (
      dealState?.timerStartedAt === null &&
      (lower.includes("i'm here") ||
        lower.includes('arrived') ||
        lower.includes('at the dealer') ||
        lower.includes('just got here'))
    ) {
      startTimer()
    }
  }

  const handleQuickAction = (prompt: string) => {
    if (prompt) {
      sendMessage(prompt)
    }
  }

  return {
    messages,
    isSending,
    isLoading,
    streamingText,
    dealState,
    send,
    handleQuickAction,
    toggleChecklistItem,
  }
}
