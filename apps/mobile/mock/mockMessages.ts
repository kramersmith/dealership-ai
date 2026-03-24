import type { Message, ToolCall } from '@/lib/types'
import { generateId } from '@/lib/utils'

interface MockResponse {
  keywords: string[]
  content: string
  toolCalls?: ToolCall[]
}

const MOCK_RESPONSES: MockResponse[] = [
  {
    keywords: ['camry', 'toyota'],
    content: "I've set up the 2024 Toyota Camry XLE for you. At $32,500 asking price, this is slightly above the average transaction price of $31,200 for this trim in your market. You have room to negotiate — I'd target $30,500 and walk away above $32,000. Let me build your checklist.",
    toolCalls: [
      { name: 'set_vehicle', args: { year: 2024, make: 'Toyota', model: 'Camry', trim: 'XLE', color: 'Midnight Black', mileage: 12 } },
      { name: 'update_deal_numbers', args: { msrp: 32500, yourTarget: 30500, walkAwayPrice: 32000 } },
      { name: 'update_deal_phase', args: { phase: 'research' } },
      { name: 'update_scorecard', args: { price: 'yellow', overall: 'yellow' } },
      { name: 'update_checklist', args: { items: [
        { label: 'Check market value against comparable listings', done: true },
        { label: 'Get pre-approved for financing', done: false },
        { label: 'Research current incentives/rebates', done: false },
        { label: 'Prepare target and walk-away prices', done: true },
        { label: 'Review common add-ons to decline', done: false },
      ] } },
    ],
  },
  {
    keywords: ['f-250', 'f250', 'ford', 'truck', 'lariat'],
    content: "I've set up the 2022 Ford F-250 Lariat. At 175k miles this is a high-mileage commercial vehicle — the 7.3L Godzilla V8 is solid but transmission risk is real at this mileage. CARFAX value is around $32,780. I'd target $31,000 and walk above $33,000.",
    toolCalls: [
      { name: 'set_vehicle', args: { year: 2022, make: 'Ford', model: 'F-250', trim: 'Lariat', mileage: 175000, color: 'Black' } },
      { name: 'update_deal_numbers', args: { msrp: 34000, yourTarget: 31000, walkAwayPrice: 33000 } },
      { name: 'update_deal_phase', args: { phase: 'research' } },
      { name: 'update_scorecard', args: { price: 'yellow', overall: 'yellow' } },
      { name: 'update_checklist', args: { items: [
        { label: 'Pull CARFAX report', done: false },
        { label: 'Check for open recalls', done: false },
        { label: 'Get pre-approved for financing', done: false },
        { label: 'Prepare target and walk-away prices', done: true },
        { label: 'Plan independent inspection', done: false },
        { label: 'Test drive: focus on transmission behavior', done: false },
      ] } },
    ],
  },
  {
    keywords: ['offer', 'asking', 'price is', 'they want', 'otd', 'out the door', 'out-the-door'],
    content: "Got it — I've updated the offer. Let me assess where this falls against your targets.",
    toolCalls: [
      { name: 'update_deal_numbers', args: { theirOffer: 34000, currentOffer: 34000 } },
      { name: 'update_deal_phase', args: { phase: 'negotiation' } },
      { name: 'update_scorecard', args: { price: 'red', overall: 'yellow' } },
    ],
  },
  {
    keywords: ['arrived', 'here now', "i'm here", 'at the dealer', 'just got here'],
    content: "You're on. Stay calm, be polite, and remember — you are just looking. Don't show excitement. Here's your quick rundown:\n\n1. Inspect the vehicle quietly\n2. Test drive thoroughly (focus on transmission)\n3. Ask for the out-the-door price in writing\n4. Don't discuss financing until price is settled\n\nI've started your timer. Send me what they say and I'll help you respond.",
    toolCalls: [
      { name: 'update_deal_phase', args: { phase: 'initial_contact' } },
    ],
  },
  {
    keywords: ['walk', 'leave', 'should i go', 'too high', 'not budging', "won't move"],
    content: "Based on the current numbers — yes, I'd walk. Their offer is above your walk-away price. Stand up calmly and say:\n\n\"I appreciate your time. I'm going to think on it.\"\n\nThen leave. Don't look back. If they want the deal, they'll call you. If they don't, you avoided overpaying.",
    toolCalls: [
      { name: 'update_scorecard', args: { overall: 'red' } },
    ],
  },
  {
    keywords: ['rate', 'apr', 'interest', 'financing', '%'],
    content: "With your credit profile, you should be looking at 5.5%-6.5% APR. If they're offering higher than that, they're marking up the rate. Say:\n\n\"I already have financing lined up. If you can beat my rate, I'll go with you.\"\n\nThat forces them to compete.",
    toolCalls: [
      { name: 'update_deal_phase', args: { phase: 'financing' } },
      { name: 'update_deal_numbers', args: { apr: 9.99 } },
      { name: 'update_scorecard', args: { financing: 'red', overall: 'yellow' } },
    ],
  },
  {
    keywords: ['gap', 'warranty', 'add-on', 'protection', 'f&i', 'finance office'],
    content: "In the F&I office, say this first:\n\n\"I'm not adding anything.\"\n\nThen decline everything they pitch. The exception: GAP insurance might make sense if you're putting little down on a depreciating vehicle — but get the total price, not the monthly. If it's over $600 at the dealer, get it through your insurance company instead (~$5-10/mo).",
    toolCalls: [
      { name: 'update_deal_phase', args: { phase: 'financing' } },
    ],
  },
  {
    keywords: ['game plan', 'strategy', 'prepare', 'tips', 'advice', 'help me'],
    content: "Here's your game plan:\n\n**Before you go:**\n• Know your target price and walk-away price\n• Get pre-approved at a credit union\n• Research the vehicle's market value\n\n**At the dealership:**\n• Stay calm and detached\n• Negotiate on out-the-door price, not monthly payment\n• Get every number in writing\n• Be willing to walk — that's your biggest leverage\n\n**In F&I:**\n• Decline all add-ons unless you've researched them\n• Verify the APR matches what you were told\n• Read before signing",
    toolCalls: [
      { name: 'update_checklist', args: { items: [
        { label: 'Know your max out-the-door price', done: false },
        { label: 'Get pre-approved for financing', done: false },
        { label: 'Research vehicle market value', done: false },
        { label: 'Bring: license, insurance, proof of address, payment', done: false },
        { label: 'Set target and walk-away prices', done: false },
      ] } },
    ],
  },
]

const DEFAULT_RESPONSE: MockResponse = {
  keywords: [],
  content: "I'm here to help you navigate this deal. Tell me about the vehicle you're looking at (year, make, model, price) and I'll set up your dashboard. Or if you're already at the dealership, let me know what's happening and I'll help you respond.",
  toolCalls: [],
}

export function findMockResponse(userMessage: string): MockResponse {
  const lower = userMessage.toLowerCase()
  for (const response of MOCK_RESPONSES) {
    if (response.keywords.some((kw) => lower.includes(kw))) {
      return response
    }
  }
  return DEFAULT_RESPONSE
}

export function createUserMessage(sessionId: string, content: string, imageUri?: string): Message {
  return {
    id: generateId(),
    sessionId,
    role: 'user',
    content,
    imageUri,
    createdAt: new Date().toISOString(),
  }
}

export function createAssistantMessage(sessionId: string, response: MockResponse): Message {
  return {
    id: generateId(),
    sessionId,
    role: 'assistant',
    content: response.content,
    toolCalls: response.toolCalls,
    createdAt: new Date().toISOString(),
  }
}
