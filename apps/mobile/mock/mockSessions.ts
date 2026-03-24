import type { Session } from '@/lib/types'

export const MOCK_SESSIONS: Session[] = [
  {
    id: 'session-1',
    title: '2022 F-250 Lariat — Fairfield, TX',
    sessionType: 'buyer_chat',
    linkedSessionIds: [],
    lastMessagePreview: "With 175k miles and commercial use, I'm at $31k.",
    updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'session-2',
    title: '2024 Camry XLE — OKC',
    sessionType: 'buyer_chat',
    linkedSessionIds: [],
    lastMessagePreview: "Let me set up your game plan for tomorrow.",
    updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'session-3',
    title: 'Price Negotiation Training',
    sessionType: 'dealer_sim',
    linkedSessionIds: [],
    lastMessagePreview: "I like the truck, but I'm not sure about the price...",
    updatedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
  },
]
