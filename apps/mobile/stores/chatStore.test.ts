import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import type { AiPanelCard, Message, QuickAction, Session, VinAssistItem } from '@/lib/types'
import { normalizeVinCandidate, normalizeVinCandidates, useChatStore } from '@/stores/chatStore'
import { useDealStore } from '@/stores/dealStore'

const baseState = {
  activeSessionId: 'session-1',
  messages: [] as Message[],
  sessions: [] as Session[],
  isLoading: false,
  isCreatingSession: false,
  isSending: false,
  sendError: null,
  quickActions: [] as QuickAction[],
  aiResponseCount: 0,
  quickActionsUpdatedAtResponse: 0,
  streamingText: '',
  isRetrying: false,
  isThinking: false,
  isPanelAnalyzing: false,
  vinAssistItems: [] as VinAssistItem[],
  _sessionJustCreated: false,
  _pendingSend: null,
  contextPressure: null,
  isCompacting: false,
  suppressContextWarningUntilUsageRefresh: false,
  editingUserMessageId: null,
}

describe('normalizeVinCandidate / normalizeVinCandidates', () => {
  it('normalizeVinCandidate returns the uppercase VIN when a valid one is present', () => {
    expect(normalizeVinCandidate('my vin is 1hgbh41jxmn109186, thanks')).toBe('1HGBH41JXMN109186')
  })

  it('normalizeVinCandidate rejects VINs containing I, O, or Q', () => {
    expect(normalizeVinCandidate('IHGBH41JXMN109186')).toBeNull()
    expect(normalizeVinCandidate('OHGBH41JXMN109186')).toBeNull()
    expect(normalizeVinCandidate('QHGBH41JXMN109186')).toBeNull()
  })

  it('normalizeVinCandidate returns null when no 17-char VIN is present', () => {
    expect(normalizeVinCandidate('no vin here')).toBeNull()
  })

  it('normalizeVinCandidates returns all distinct valid VINs in order', () => {
    const text = 'Comparing 1HGBH41JXMN109186 and 2HGFC2F59KH123456 to 1HGBH41JXMN109186 again.'
    expect(normalizeVinCandidates(text)).toEqual(['1HGBH41JXMN109186', '2HGFC2F59KH123456'])
  })

  it('normalizeVinCandidates returns an empty array when none are present', () => {
    expect(normalizeVinCandidates('just some text')).toEqual([])
  })

  it('normalizeVinCandidates caps results at maxCount', () => {
    const vins = ['1HGBH41JXMN109186', '2HGFC2F59KH123456', '3VWCK21Y25M362149']
    const text = `first ${vins[0]} then ${vins[1]} and ${vins[2]}`
    expect(normalizeVinCandidates(text, 2)).toEqual([vins[0], vins[1]])
  })

  it('normalizeVinCandidates skips VINs containing disallowed letters', () => {
    // Second token contains an "I" and must be filtered out.
    const text = 'a 1HGBH41JXMN109186 b 1HGBH4IJXMN109186 c 2HGFC2F59KH123456'
    expect(normalizeVinCandidates(text)).toEqual(['1HGBH41JXMN109186', '2HGFC2F59KH123456'])
  })
})

describe('useChatStore.sendMessage', () => {
  const originalSendMessage = api.sendMessage
  const originalBranchFromUserMessage = api.branchFromUserMessage
  const originalGetSessions = api.getSessions
  const originalGetMessages = api.getMessages
  const originalGetDealState = api.getDealState
  const originalPersistUserMessage = api.persistUserMessage

  beforeEach(() => {
    useChatStore.setState(baseState)
    api.getSessions = vi.fn().mockResolvedValue([])
  })

  afterEach(() => {
    api.sendMessage = originalSendMessage
    api.branchFromUserMessage = originalBranchFromUserMessage
    api.getSessions = originalGetSessions
    api.getMessages = originalGetMessages
    api.getDealState = originalGetDealState
    api.persistUserMessage = originalPersistUserMessage
    useDealStore.setState({ dealState: null, isLoading: false, dismissedFlagIds: new Set() })
  })

  it('clears deal AI panel cards when a panel stream starts', async () => {
    useDealStore.setState({
      dealState: {
        sessionId: 'session-1',
        buyerContext: 'researching',
        activeDealId: null,
        vehicles: [],
        deals: [],
        redFlags: [],
        informationGaps: [],
        checklist: [],
        timerStartedAt: null,
        aiPanelCards: [
          {
            kind: 'warning',
            template: 'warning',
            title: 'Stale',
            content: { body: 'old' },
            priority: 'high',
          },
        ],
        dealComparison: null,
        negotiationContext: null,
      },
      isLoading: false,
      dismissedFlagIds: new Set(),
    })

    let cardsWhenPanelStarted: AiPanelCard[] | undefined

    api.sendMessage = vi.fn(
      async (
        sessionId,
        content,
        imageUri,
        onChunk,
        onToolResult,
        onTextDone,
        onRetry,
        onStep,
        onPanelStarted
      ) => {
        void sessionId
        void content
        void imageUri
        void onChunk
        void onToolResult
        void onRetry
        void onStep

        onTextDone?.('Assistant reply')
        onPanelStarted?.()
        cardsWhenPanelStarted = useDealStore.getState().dealState?.aiPanelCards

        return {
          id: 'assistant-1',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'Assistant reply',
          createdAt: new Date().toISOString(),
        }
      }
    ) as typeof api.sendMessage

    await useChatStore.getState().sendMessage('hello', undefined, undefined, true)

    expect(cardsWhenPanelStarted).toEqual([])
  })

  it('tracks panel analysis while the panel phase is active', async () => {
    let finishPanel: (() => void) | undefined
    api.sendMessage = vi.fn(
      async (
        sessionId,
        content,
        imageUri,
        onChunk,
        onToolResult,
        onTextDone,
        onRetry,
        onStep,
        onPanelStarted,
        onPanelFinished
      ) => {
        void sessionId
        void content
        void imageUri
        void onChunk
        void onToolResult
        void onRetry
        void onStep

        onTextDone?.('Assistant reply')
        onPanelStarted?.()

        await new Promise<void>((resolve) => {
          finishPanel = () => {
            onPanelFinished?.()
            resolve()
          }
        })

        return {
          id: 'assistant-1',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'Assistant reply',
          createdAt: new Date().toISOString(),
        }
      }
    ) as typeof api.sendMessage

    const sendPromise = useChatStore.getState().sendMessage('hello', undefined, undefined, true)

    expect(useChatStore.getState().isPanelAnalyzing).toBe(true)

    finishPanel?.()
    await sendPromise

    const state = useChatStore.getState()
    expect(state.isPanelAnalyzing).toBe(false)
    expect(state.isSending).toBe(false)
    expect(state.messages.at(-1)?.content).toBe('Assistant reply')
  })

  it('clears panel analysis state when the send fails after panel start', async () => {
    api.sendMessage = vi.fn(
      async (
        sessionId,
        content,
        imageUri,
        onChunk,
        onToolResult,
        onTextDone,
        onRetry,
        onStep,
        onPanelStarted
      ) => {
        void sessionId
        void content
        void imageUri
        void onChunk
        void onToolResult
        void onTextDone
        void onRetry
        void onStep

        onPanelStarted?.()
        throw new Error('panel request failed')
      }
    ) as typeof api.sendMessage

    await useChatStore.getState().sendMessage('hello', undefined, undefined, true)

    const state = useChatStore.getState()
    expect(state.isPanelAnalyzing).toBe(false)
    expect(state.isSending).toBe(false)
    expect(state.sendError).toBe('panel request failed')
  })

  it('sets isCompacting during compaction and clears it after send completes', async () => {
    let compactionCallback: ((phase: 'started' | 'done' | 'error') => void) | undefined

    api.sendMessage = vi.fn(
      async (
        sessionId,
        content,
        imageUri,
        onChunk,
        onToolResult,
        onTextDone,
        onRetry,
        onStep,
        onPanelStarted,
        onPanelFinished,
        onCompaction
      ) => {
        void sessionId
        void content
        void imageUri
        void onChunk
        void onToolResult
        void onRetry
        void onStep
        void onPanelStarted
        void onPanelFinished

        compactionCallback = onCompaction
        onCompaction?.('started')
        // Simulate compaction completing before text streaming
        onCompaction?.('done')
        onTextDone?.('Reply after compaction')

        return {
          id: 'a-compact',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'Reply after compaction',
          createdAt: new Date().toISOString(),
        }
      }
    ) as typeof api.sendMessage

    await useChatStore.getState().sendMessage('hello', undefined, undefined, true)

    const state = useChatStore.getState()
    expect(state.isCompacting).toBe(false)
    expect(state.suppressContextWarningUntilUsageRefresh).toBe(false)
    expect(compactionCallback).toBeDefined()
  })

  it('multi-VIN: persists user message via persistUserMessage and stashes _pendingSend with sourceMessageId', async () => {
    const persistedId = 'persisted-user-msg-42'
    const persistSpy = vi.fn(
      async (_sessionId: string, content: string): Promise<Message> => ({
        id: persistedId,
        sessionId: 'session-1',
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
      })
    )
    api.persistUserMessage = persistSpy as typeof api.persistUserMessage
    const sendSpy = vi.fn()
    api.sendMessage = sendSpy as typeof api.sendMessage

    await useChatStore
      .getState()
      .sendMessage(
        'Compare VINs 1HGBH41JXMN109186 and 2HGFC2F59KH123456',
        undefined,
        undefined,
        false
      )

    expect(persistSpy).toHaveBeenCalledTimes(1)
    // Do NOT stream while multi-VIN intercept is awaiting decode/confirm.
    expect(sendSpy).not.toHaveBeenCalled()

    const state = useChatStore.getState()
    expect(state.messages.at(-1)?.id).toBe(persistedId)
    expect(state._pendingSend?.sourceMessageId).toBe(persistedId)
    // Both VINs attached to the same persisted user message.
    expect(state.vinAssistItems).toHaveLength(2)
    expect(state.vinAssistItems.every((item) => item.sourceMessageId === persistedId)).toBe(true)
    const vins = state.vinAssistItems.map((item) => item.vin).sort()
    expect(vins).toEqual(['1HGBH41JXMN109186', '2HGFC2F59KH123456'])
    expect(state.isSending).toBe(false)
  })

  it('resumePendingSend: appends per-VIN status lines and resumes with existingUserMessageId', async () => {
    const persistedId = 'user-msg-resume'
    // Seed state as if a multi-VIN intercept already ran and both items reached terminal states.
    useChatStore.setState({
      ...baseState,
      messages: [
        {
          id: persistedId,
          sessionId: 'session-1',
          role: 'user',
          content: 'Compare VINs 1HGBH41JXMN109186 and 2HGFC2F59KH123456',
          createdAt: new Date().toISOString(),
        },
      ],
      vinAssistItems: [
        {
          id: 'v1',
          sessionId: 'session-1',
          vin: '1HGBH41JXMN109186',
          sourceMessageId: persistedId,
          status: 'confirmed',
          decodedVehicle: { year: 2021, make: 'Honda', model: 'Civic', partial: false },
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'v2',
          sessionId: 'session-1',
          vin: '2HGFC2F59KH123456',
          sourceMessageId: persistedId,
          status: 'skipped',
          updatedAt: new Date().toISOString(),
        },
      ],
      _pendingSend: {
        content: 'Compare these two for me',
        imageUri: undefined,
        quotedCard: undefined,
        sourceMessageId: persistedId,
      },
    })

    let sentContent: string | undefined
    let sentExistingId: string | undefined
    api.sendMessage = vi.fn(
      async (
        _sessionId,
        content,
        _imageUri,
        _onChunk,
        _onToolResult,
        onTextDone,
        _onRetry,
        _onStep,
        _onPanelStarted,
        _onPanelFinished,
        _onCompaction,
        existingUserMessageId
      ) => {
        sentContent = content
        sentExistingId = existingUserMessageId
        onTextDone?.('ok')
        return {
          id: 'a-resume',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'ok',
          createdAt: new Date().toISOString(),
        }
      }
    ) as typeof api.sendMessage

    await useChatStore.getState().resumePendingSend()

    expect(sentExistingId).toBe(persistedId)
    expect(sentContent).toContain('Compare these two for me')
    // One appendix line per VIN (confirmed + skipped)
    expect(sentContent).toContain('[VIN 1HGBH41JXMN109186 decoded: 2021 Honda Civic]')
    expect(sentContent).toContain('[VIN 2HGFC2F59KH123456: continued without decode/confirm]')
    expect(useChatStore.getState()._pendingSend).toBeNull()
  })

  it('sets suppressContextWarningUntilUsageRefresh during send and clears after', async () => {
    api.sendMessage = vi.fn(
      async (_sessionId, _content, _imageUri, _onChunk, _onToolResult, onTextDone) => {
        // During send, suppressContextWarningUntilUsageRefresh should be true
        expect(useChatStore.getState().suppressContextWarningUntilUsageRefresh).toBe(true)
        onTextDone?.('reply')
        return {
          id: 'a-suppress',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'reply',
          createdAt: new Date().toISOString(),
        }
      }
    ) as typeof api.sendMessage

    await useChatStore.getState().sendMessage('hello', undefined, undefined, true)

    expect(useChatStore.getState().suppressContextWarningUntilUsageRefresh).toBe(false)
  })

  it('sendBranchFromEdit truncates the local tail and appends the branched reply', async () => {
    const anchorId = '00000000-0000-4000-8000-000000000001'
    const assistantId = '00000000-0000-4000-8000-000000000002'
    const laterUserId = '00000000-0000-4000-8000-000000000003'
    const createdAt = new Date().toISOString()

    useChatStore.setState({
      ...baseState,
      messages: [
        {
          id: anchorId,
          sessionId: 'session-1',
          role: 'user',
          content: 'Original question',
          createdAt,
        },
        {
          id: assistantId,
          sessionId: 'session-1',
          role: 'assistant',
          content: 'Older answer',
          createdAt,
        },
        {
          id: laterUserId,
          sessionId: 'session-1',
          role: 'user',
          content: 'Later question',
          createdAt,
        },
      ],
      quickActions: [{ label: 'Old action', prompt: 'stale' }],
      editingUserMessageId: anchorId,
    })

    useDealStore.setState({
      dealState: {
        sessionId: 'session-1',
        buyerContext: 'reviewing_deal',
        activeDealId: 'deal-1',
        vehicles: [{ id: 'vehicle-1', role: 'primary', make: 'Ford', model: 'F-150', year: 2024 }],
        deals: [
          {
            id: 'deal-1',
            vehicleId: 'vehicle-1',
            dealerName: 'Acme',
            phase: 'research',
            numbers: {
              msrp: null,
              invoicePrice: null,
              listingPrice: 42000,
              yourTarget: null,
              walkAwayPrice: null,
              currentOffer: null,
              monthlyPayment: null,
              apr: null,
              loanTermMonths: null,
              downPayment: null,
              tradeInValue: null,
            },
            scorecard: {
              price: null,
              financing: null,
              tradeIn: null,
              fees: null,
              overall: null,
            },
            health: null,
            redFlags: [],
            informationGaps: [],
            firstOffer: null,
            preFiPrice: null,
            savingsEstimate: null,
          },
        ],
        redFlags: [],
        informationGaps: [],
        checklist: [],
        timerStartedAt: null,
        aiPanelCards: [
          {
            kind: 'warning',
            template: 'warning',
            title: 'Old warning',
            content: { body: 'stale' },
            priority: 'high',
          },
        ],
        dealComparison: null,
        negotiationContext: null,
      },
      isLoading: false,
      dismissedFlagIds: new Set(['flag-1']),
    })

    let messagesSeenAtApiBoundary: string[] = []
    let quickActionsSeenAtApiBoundary: QuickAction[] = []
    let dealStateSeenAtApiBoundary = useDealStore.getState().dealState
    api.branchFromUserMessage = vi.fn(
      async (
        _sessionId,
        anchorUserMessageId,
        content,
        _imageUri,
        onChunk,
        _onToolResult,
        onTextDone
      ) => {
        messagesSeenAtApiBoundary = useChatStore
          .getState()
          .messages.map((message) => message.content)
        quickActionsSeenAtApiBoundary = useChatStore.getState().quickActions
        dealStateSeenAtApiBoundary = useDealStore.getState().dealState
        expect(anchorUserMessageId).toBe(anchorId)
        expect(content).toBe('Edited question')
        onChunk?.('streaming')
        onTextDone?.('Branched reply')
        return {
          id: 'assistant-branch',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'Branched reply',
          createdAt: new Date().toISOString(),
        }
      }
    ) as typeof api.branchFromUserMessage

    api.getMessages = vi.fn(async () => ({
      messages: [
        {
          id: anchorId,
          sessionId: 'session-1',
          role: 'user',
          content: 'Edited question',
          createdAt,
        },
        {
          id: 'assistant-branch',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'Branched reply',
          createdAt,
        },
      ],
      contextPressure: { level: 'ok', estimatedInputTokens: 1200, inputBudget: 180000 },
    })) as typeof api.getMessages

    api.getDealState = vi.fn(async () => ({
      sessionId: 'session-1',
      buyerContext: 'researching',
      activeDealId: null,
      vehicles: [],
      deals: [],
      redFlags: [],
      informationGaps: [],
      checklist: [],
      timerStartedAt: null,
      aiPanelCards: [],
      dealComparison: null,
      negotiationContext: null,
    })) as typeof api.getDealState

    await useChatStore.getState().sendBranchFromEdit('Edited question')

    expect(messagesSeenAtApiBoundary).toEqual(['Edited question'])
    expect(quickActionsSeenAtApiBoundary).toEqual([])
    expect(dealStateSeenAtApiBoundary).toMatchObject({
      buyerContext: 'reviewing_deal',
      activeDealId: null,
      vehicles: [],
      deals: [],
      aiPanelCards: [],
    })
    expect(api.branchFromUserMessage).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().editingUserMessageId).toBeNull()
    expect(useChatStore.getState().sendError).toBeNull()
    expect(useChatStore.getState().isSending).toBe(false)
    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
      'Edited question',
      'Branched reply',
    ])
  })

  it('sendBranchFromEdit rejects VIN edits and does not call the branch endpoint', async () => {
    const anchorId = '00000000-0000-4000-8000-000000000001'

    useChatStore.setState({
      ...baseState,
      messages: [
        {
          id: anchorId,
          sessionId: 'session-1',
          role: 'user',
          content: 'Original question',
          createdAt: new Date().toISOString(),
        },
      ],
      editingUserMessageId: anchorId,
    })

    const branchSpy = vi.fn()
    api.branchFromUserMessage = branchSpy as typeof api.branchFromUserMessage

    await useChatStore.getState().sendBranchFromEdit('please use VIN 1HGBH41JXMN109186 instead')

    expect(branchSpy).not.toHaveBeenCalled()
    expect(useChatStore.getState().sendError).toContain('Remove VINs from this edit')
    expect(useChatStore.getState().editingUserMessageId).toBe(anchorId)
  })

  it('refreshes authoritative state from the server when a branch send fails', async () => {
    const anchorId = '11111111-1111-4111-8111-111111111111'
    const createdAt = new Date().toISOString()

    useChatStore.setState({
      ...baseState,
      messages: [
        {
          id: anchorId,
          sessionId: 'session-1',
          role: 'user',
          content: 'Original question',
          createdAt,
        },
        {
          id: 'assistant-older',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'Older answer',
          createdAt,
        },
      ],
      editingUserMessageId: anchorId,
    })

    useDealStore.setState({
      dealState: {
        sessionId: 'session-1',
        buyerContext: 'researching',
        activeDealId: 'deal-1',
        vehicles: [{ id: 'vehicle-1', role: 'primary', make: 'Ford', model: 'F-150', year: 2023 }],
        deals: [
          {
            id: 'deal-1',
            vehicleId: 'vehicle-1',
            dealerName: null,
            phase: 'research',
            numbers: {
              msrp: null,
              invoicePrice: null,
              listingPrice: null,
              yourTarget: null,
              walkAwayPrice: null,
              currentOffer: null,
              monthlyPayment: null,
              apr: null,
              loanTermMonths: null,
              downPayment: null,
              tradeInValue: null,
            },
            scorecard: {
              price: null,
              financing: null,
              tradeIn: null,
              fees: null,
              overall: null,
            },
            health: null,
            redFlags: [],
            informationGaps: [],
            firstOffer: null,
            preFiPrice: null,
            savingsEstimate: null,
          },
        ],
        redFlags: [],
        informationGaps: [],
        checklist: [],
        timerStartedAt: null,
        aiPanelCards: [],
        dealComparison: null,
        negotiationContext: null,
      },
      isLoading: false,
      dismissedFlagIds: new Set(),
    })

    api.branchFromUserMessage = vi.fn(async () => {
      throw new Error('Branch anchor must be a user message')
    }) as typeof api.branchFromUserMessage

    api.getMessages = vi.fn(async () => ({
      messages: [
        {
          id: anchorId,
          sessionId: 'session-1',
          role: 'user' as const,
          content: 'Server-authoritative question',
          createdAt,
        },
      ],
      contextPressure: { level: 'ok' as const, estimatedInputTokens: 0, inputBudget: 0 },
    })) as typeof api.getMessages

    api.getDealState = vi.fn(async () => ({
      sessionId: 'session-1',
      buyerContext: 'researching',
      activeDealId: null,
      vehicles: [],
      deals: [],
      redFlags: [],
      informationGaps: [],
      checklist: [],
      timerStartedAt: null,
      aiPanelCards: [],
      dealComparison: null,
      negotiationContext: null,
    })) as typeof api.getDealState

    await useChatStore.getState().sendBranchFromEdit('Edited question')

    const state = useChatStore.getState()
    // Backend commits truncation before streaming, so server state is the source of
    // truth on failure. Edit mode is closed by the optimistic update and not reopened;
    // the silent loadMessages() refresh replaces the local timeline with the
    // server-authoritative anchor row.
    expect(state.sendError).toBe('Branch anchor must be a user message')
    expect(state.editingUserMessageId).toBeNull()
    expect(state.messages).toEqual([
      {
        id: anchorId,
        sessionId: 'session-1',
        role: 'user',
        content: 'Server-authoritative question',
        createdAt,
      },
    ])
    expect(api.getMessages).toHaveBeenCalledWith('session-1')
  })

  it('keeps the optimistic truncation and marks the anchor failed when branch send and refresh both fail', async () => {
    const anchorId = '11111111-1111-4111-8111-111111111111'
    const createdAt = new Date().toISOString()
    const originalMessages: Message[] = [
      {
        id: anchorId,
        sessionId: 'session-1',
        role: 'user',
        content: 'Original question',
        createdAt,
      },
      {
        id: 'assistant-older',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'Older answer',
        createdAt,
      },
    ]
    const originalVinAssistItems: VinAssistItem[] = [
      {
        id: 'vin-1',
        sessionId: 'session-1',
        vin: '1HGBH41JXMN109186',
        sourceMessageId: anchorId,
        status: 'decoded',
        updatedAt: createdAt,
      },
    ]
    const originalQuickActions: QuickAction[] = [{ label: 'Ask for OTD', prompt: 'ask for OTD' }]
    const originalDealState = {
      sessionId: 'session-1',
      buyerContext: 'researching' as const,
      activeDealId: 'deal-1',
      vehicles: [
        { id: 'vehicle-1', role: 'primary' as const, make: 'Toyota', model: 'Camry', year: 2024 },
      ],
      deals: [
        {
          id: 'deal-1',
          vehicleId: 'vehicle-1',
          dealerName: null,
          phase: 'research' as const,
          numbers: {
            msrp: null,
            invoicePrice: null,
            listingPrice: 32000,
            yourTarget: null,
            walkAwayPrice: null,
            currentOffer: null,
            monthlyPayment: null,
            apr: null,
            loanTermMonths: null,
            downPayment: null,
            tradeInValue: null,
          },
          scorecard: {
            price: null,
            financing: null,
            tradeIn: null,
            fees: null,
            overall: null,
          },
          health: null,
          redFlags: [],
          informationGaps: [],
          firstOffer: null,
          preFiPrice: null,
          savingsEstimate: null,
        },
      ],
      redFlags: [],
      informationGaps: [],
      checklist: [],
      timerStartedAt: null,
      aiPanelCards: [],
      dealComparison: null,
      negotiationContext: null,
    }

    useChatStore.setState({
      ...baseState,
      messages: originalMessages,
      vinAssistItems: originalVinAssistItems,
      quickActions: originalQuickActions,
      quickActionsUpdatedAtResponse: 2,
      editingUserMessageId: anchorId,
    })

    useDealStore.setState({
      dealState: originalDealState,
      isLoading: false,
      dismissedFlagIds: new Set(['flag-1']),
    })

    api.branchFromUserMessage = vi.fn(async () => {
      throw new Error('branch failed')
    }) as typeof api.branchFromUserMessage

    api.getMessages = vi.fn(async () => {
      throw new Error('silent refresh unavailable')
    }) as typeof api.getMessages

    api.getDealState = vi.fn(async () => {
      throw new Error('deal refresh unavailable')
    }) as typeof api.getDealState

    await useChatStore.getState().sendBranchFromEdit('Edited question')

    const state = useChatStore.getState()
    // Backend commits truncation before streaming. The optimistic local truncation
    // therefore matches what the server already has; the silent refresh failure
    // leaves the in-memory state as the truncated tail with the anchor marked failed.
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0]?.id).toBe(anchorId)
    expect(state.messages[0]?.content).toBe('Edited question')
    expect(state.messages[0]?.status).toBe('failed')
    expect(state.editingUserMessageId).toBeNull()
    expect(state.sendError).toBe('branch failed')
    expect(state.vinAssistItems).toEqual(originalVinAssistItems)
  })

  it('startEditUserMessage enters edit mode for a server-id user message', () => {
    const anchorId = '22222222-2222-4222-8222-222222222222'
    useChatStore.setState({
      ...baseState,
      messages: [
        {
          id: anchorId,
          sessionId: 'session-1',
          role: 'user',
          content: 'original',
          createdAt: new Date().toISOString(),
        },
      ],
    })

    useChatStore.getState().startEditUserMessage(anchorId)
    expect(useChatStore.getState().editingUserMessageId).toBe(anchorId)
    expect(useChatStore.getState().sendError).toBeNull()
  })

  it('startEditUserMessage ignores non-server (client placeholder) ids', () => {
    const clientId = 'greeting-placeholder-1'
    useChatStore.setState({
      ...baseState,
      messages: [
        {
          id: clientId,
          sessionId: 'session-1',
          role: 'user',
          content: 'hi',
          createdAt: new Date().toISOString(),
        },
      ],
    })

    useChatStore.getState().startEditUserMessage(clientId)
    expect(useChatStore.getState().editingUserMessageId).toBeNull()
  })

  it('startEditUserMessage refuses to enter edit mode while isSending is true', () => {
    const anchorId = '33333333-3333-4333-8333-333333333333'
    useChatStore.setState({
      ...baseState,
      isSending: true,
      messages: [
        {
          id: anchorId,
          sessionId: 'session-1',
          role: 'user',
          content: 'original',
          createdAt: new Date().toISOString(),
        },
      ],
    })

    useChatStore.getState().startEditUserMessage(anchorId)
    expect(useChatStore.getState().editingUserMessageId).toBeNull()
  })

  it('startEditUserMessage refuses to enter edit mode while a VIN intercept send is pending', () => {
    const anchorId = '33333333-3333-4333-8333-333333333334'
    useChatStore.setState({
      ...baseState,
      _pendingSend: {
        content: 'compare these cars',
        imageUri: undefined,
        quotedCard: undefined,
        sourceMessageId: anchorId,
      },
      messages: [
        {
          id: anchorId,
          sessionId: 'session-1',
          role: 'user',
          content: 'original',
          createdAt: new Date().toISOString(),
        },
      ],
    })

    useChatStore.getState().startEditUserMessage(anchorId)
    expect(useChatStore.getState().editingUserMessageId).toBeNull()
  })

  it('startEditUserMessage refuses to enter edit mode for a failed user message', () => {
    const anchorId = '44444444-4444-4444-8444-444444444444'
    useChatStore.setState({
      ...baseState,
      messages: [
        {
          id: anchorId,
          sessionId: 'session-1',
          role: 'user',
          content: 'never sent',
          status: 'failed',
          createdAt: new Date().toISOString(),
        },
      ],
    })

    useChatStore.getState().startEditUserMessage(anchorId)
    expect(useChatStore.getState().editingUserMessageId).toBeNull()
  })

  it('cancelEditUserMessage clears the editingUserMessageId', () => {
    const anchorId = '55555555-5555-4555-8555-555555555555'
    useChatStore.setState({
      ...baseState,
      editingUserMessageId: anchorId,
    })

    useChatStore.getState().cancelEditUserMessage()
    expect(useChatStore.getState().editingUserMessageId).toBeNull()
  })

  it('sendBranchFromEdit is a no-op when not in edit mode', async () => {
    useChatStore.setState({
      ...baseState,
      editingUserMessageId: null,
    })
    const branchSpy = vi.fn()
    api.branchFromUserMessage = branchSpy as typeof api.branchFromUserMessage

    await useChatStore.getState().sendBranchFromEdit('anything')
    expect(branchSpy).not.toHaveBeenCalled()
  })
})
