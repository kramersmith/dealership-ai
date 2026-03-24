import { useEffect } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useDealStore } from '@/stores/dealStore'

export function useChat(sessionId: string | null) {
  const { messages, isSending, isLoading, setActiveSession, sendMessage } = useChatStore()

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
      // Researching
      compare_prices: 'Help me compare prices for this car. What should I expect to pay?',
      new_or_used: 'Should I buy new or used? What are the pros and cons for my situation?',
      whats_my_budget: 'Help me figure out what I can afford. What budget should I set?',
      // Reviewing deal
      check_price: 'Is this price fair? Break down the numbers for me.',
      hidden_fees: 'What fees might be hidden in this deal? What should I watch for?',
      // At dealership
      what_to_say: 'What should I say right now? Give me a script.',
      pressuring_me: "The dealer is pressuring me. What's happening and how should I respond?",
      // Shared
      should_i_walk: 'Based on the current deal, should I walk away?',
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
