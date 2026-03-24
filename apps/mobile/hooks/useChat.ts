import { useEffect } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useDealStore } from '@/stores/dealStore'

export function useChat(sessionId: string | null) {
  const {
    messages,
    isSending,
    isLoading,
    setActiveSession,
    sendMessage,
  } = useChatStore()

  const dealState = useDealStore((s) => s.dealState)
  const toggleChecklistItem = useDealStore((s) => s.toggleChecklistItem)
  const startTimer = useDealStore((s) => s.startTimer)

  useEffect(() => {
    if (sessionId) {
      setActiveSession(sessionId)
    }
  }, [sessionId])

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

  const handleQuickAction = (actionId: string) => {
    const prompts: Record<string, string> = {
      what_to_say: "What should I say right now? Give me a script.",
      should_i_walk: 'Based on the current deal, should I walk away?',
      whats_missing: "What am I forgetting? What should I check before signing?",
    }
    const prompt = prompts[actionId]
    if (prompt) {
      sendMessage(prompt)
    }
  }

  return {
    messages,
    isSending,
    isLoading,
    dealState,
    send,
    handleQuickAction,
    toggleChecklistItem,
  }
}
