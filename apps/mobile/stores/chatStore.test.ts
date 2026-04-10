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
  insightsPanelCommitGeneration: 0,
  vinAssistItems: [] as VinAssistItem[],
  _sessionJustCreated: false,
  _pendingSend: null,
  contextPressure: null,
  isCompacting: false,
  suppressContextWarningUntilUsageRefresh: false,
  editingUserMessageId: null,
  queueBySession: {},
  activeQueueItemId: null,
  isQueueDispatching: false,
  queueDispatchGeneration: 0,
  lastQueueEvent: null,
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

  it('keeps prior deal AI panel cards visible until panel_done commits', async () => {
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

    expect(cardsWhenPanelStarted).toEqual([
      {
        kind: 'warning',
        template: 'warning',
        title: 'Stale',
        content: { body: 'old' },
        priority: 'high',
      },
    ])
  })

  it('panel_done tool result: binds panelCards + assistant id to latest assistant row and bumps commit generation', async () => {
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
        aiPanelCards: [],
        dealComparison: null,
        negotiationContext: null,
      },
      isLoading: false,
      dismissedFlagIds: new Set(),
    })

    const serverId = '11111111-2222-4333-8444-555555555555'
    const card: AiPanelCard = {
      kind: 'notes',
      template: 'briefing',
      title: 'Hold firm',
      content: { body: 'keep target' },
      priority: 'high',
    }

    api.sendMessage = vi.fn(
      async (_sessionId, _content, _imageUri, _onChunk, onToolResult, onTextDone) => {
        onTextDone?.('Assistant reply')
        // Simulate panel_done arriving via apiClient's atomic tool_result callback.
        onToolResult?.({
          name: 'update_insights_panel',
          args: { cards: [card], assistantMessageId: serverId },
        })
        return {
          id: serverId,
          sessionId: 'session-1',
          role: 'assistant',
          content: 'Assistant reply',
          createdAt: new Date().toISOString(),
        }
      }
    ) as typeof api.sendMessage

    // Prevent post-stream refresh from clobbering local state. Rejecting is
    // handled by the store's .catch so the in-memory state is preserved.
    api.getMessages = vi.fn().mockRejectedValue(new Error('no fetch in test'))
    api.getDealState = vi.fn().mockRejectedValue(new Error('no fetch in test'))

    const beforeGen = useChatStore.getState().insightsPanelCommitGeneration
    await useChatStore.getState().sendMessage('hello', undefined, undefined, true)

    const state = useChatStore.getState()
    const lastAssistant = [...state.messages].reverse().find((m) => m.role === 'assistant')
    expect(lastAssistant).toBeDefined()
    expect(lastAssistant!.id).toBe(serverId)
    expect(lastAssistant!.panelCards).toEqual([card])
    expect(state.insightsPanelCommitGeneration).toBeGreaterThan(beforeGen)
    expect(useDealStore.getState().dealState?.aiPanelCards).toEqual([card])
  })

  it('panel_done stale guard: drops update when latest assistant row is a server UUID that does not match assistantMessageId', async () => {
    const existingServerId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    const staleTargetId = '99999999-8888-4777-8666-555555555555'
    const priorCard: AiPanelCard = {
      kind: 'warning',
      template: 'warning',
      title: 'Prior',
      content: { body: 'kept' },
      priority: 'high',
    }

    // Seed a committed assistant row + panel cards from a prior turn.
    useChatStore.setState({
      ...baseState,
      messages: [
        {
          id: existingServerId,
          sessionId: 'session-1',
          role: 'assistant',
          content: 'prior reply',
          panelCards: [priorCard],
          createdAt: new Date().toISOString(),
        },
      ],
      insightsPanelCommitGeneration: 7,
    })
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
        aiPanelCards: [priorCard],
        dealComparison: null,
        negotiationContext: null,
      },
      isLoading: false,
      dismissedFlagIds: new Set(),
    })

    // Simulate a late panel_done from a *different* assistant turn arriving via
    // apiClient's onToolResult callback. No onTextDone is emitted because we are
    // testing the stale-guard path where the latest row is already a committed
    // server UUID row that doesn't match.
    api.sendMessage = vi.fn(
      async (_sessionId, _content, _imageUri, _onChunk, onToolResult, onTextDone) => {
        // Empty finalText keeps the seeded assistant row as the latest, without
        // appending a new one, and marks the turn finalized so the fallback
        // finalize path doesn't double the row.
        onTextDone?.('')
        onToolResult?.({
          name: 'update_insights_panel',
          args: {
            cards: [
              {
                kind: 'notes',
                template: 'briefing',
                title: 'Stale incoming',
                content: { body: 'should be dropped' },
                priority: 'high',
              },
            ],
            assistantMessageId: staleTargetId,
          },
        })
        return {
          id: existingServerId,
          sessionId: 'session-1',
          role: 'assistant',
          content: '',
          createdAt: new Date().toISOString(),
        }
      }
    ) as typeof api.sendMessage

    // Prevent post-stream refresh from clobbering local state.
    api.getMessages = vi.fn().mockRejectedValue(new Error('no fetch in test'))
    api.getDealState = vi.fn().mockRejectedValue(new Error('no fetch in test'))

    const beforeGen = useChatStore.getState().insightsPanelCommitGeneration
    await useChatStore.getState().sendMessage('hello', undefined, undefined, true)

    const state = useChatStore.getState()
    // The prior row must still carry its original panel cards and id.
    const seededRow = state.messages.find((m) => m.id === existingServerId)
    expect(seededRow?.panelCards).toEqual([priorCard])
    // Stale update must not bump the commit generation.
    expect(state.insightsPanelCommitGeneration).toBe(beforeGen)
    // Deal store panel cards remain untouched.
    expect(useDealStore.getState().dealState?.aiPanelCards).toEqual([priorCard])
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

  it('clears user sending status once the assistant turn starts processing', async () => {
    let release: (() => void) | undefined
    api.sendMessage = vi.fn(
      async (
        _sessionId,
        _content,
        _imageUri,
        _onChunk,
        _onToolResult,
        onTextDone,
        _onRetry,
        onStep
      ) => {
        onStep?.({ step: 1, reason: 'processing' } as any)
        await new Promise<void>((resolve) => {
          release = () => {
            onTextDone?.('reply')
            resolve()
          }
        })
        return {
          id: 'assistant-step',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'reply',
          createdAt: new Date().toISOString(),
        }
      }
    ) as typeof api.sendMessage

    const sendPromise = useChatStore.getState().sendMessage('hello', undefined, undefined, true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const duringSend = useChatStore
      .getState()
      .messages.find((message) => message.role === 'user' && message.content === 'hello')
    expect(duringSend?.status).toBeUndefined()

    release?.()
    await sendPromise
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
    expect(state.sendError).toBe(
      'branch failed We also could not refresh the chat or deal state, so this view may be out of date.'
    )
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

  it('processes queued messages in FIFO order', async () => {
    const startedContents: string[] = []
    const resolvers: Array<() => void> = []

    api.sendMessage = vi.fn(
      async (_sessionId, content, _imageUri, _onChunk, _onToolResult, onTextDone) => {
        startedContents.push(content)
        onTextDone?.(`reply:${content}`)
        await new Promise<void>((resolve) => {
          resolvers.push(resolve)
        })
        return {
          id: `assistant-${content}`,
          sessionId: 'session-1',
          role: 'assistant',
          content: `reply:${content}`,
          createdAt: new Date().toISOString(),
        }
      }
    ) as typeof api.sendMessage

    await useChatStore
      .getState()
      .sendMessage('first', undefined, undefined, true, undefined, 'typed')
    await useChatStore
      .getState()
      .sendMessage('second', undefined, undefined, true, undefined, 'typed')
    await useChatStore
      .getState()
      .sendMessage('third', undefined, undefined, true, undefined, 'typed')

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(startedContents).toEqual(['first', 'second', 'third'])

    while (resolvers.length > 0) {
      const resolve = resolvers.shift()
      resolve?.()
      await new Promise((done) => setTimeout(done, 0))
    }
  })

  it('blocks branch edit sends while queue has pending items', async () => {
    const anchorId = '77777777-7777-4777-8777-777777777777'
    const createdAt = new Date().toISOString()
    const branchSpy = vi.fn()
    api.branchFromUserMessage = branchSpy as typeof api.branchFromUserMessage

    useChatStore.setState({
      ...baseState,
      activeSessionId: 'session-1',
      editingUserMessageId: anchorId,
      messages: [
        {
          id: anchorId,
          sessionId: 'session-1',
          role: 'user',
          content: 'Original',
          createdAt,
        },
      ],
      queueBySession: {
        'session-1': [
          {
            id: 'queued-1',
            sessionId: 'session-1',
            source: 'typed',
            payload: { content: 'queued message' },
            status: 'queued',
            createdAt,
          },
        ],
      },
    })

    await useChatStore.getState().sendBranchFromEdit('Edited')

    expect(branchSpy).not.toHaveBeenCalled()
    expect(useChatStore.getState().sendError).toContain(
      'Clear queued messages before editing from here'
    )
  })

  it('clearQueue removes pending queue entries while preserving transcript', async () => {
    api.sendMessage = vi.fn(
      async (_sessionId, _content, _imageUri, _onChunk, _onToolResult, _onTextDone) => {
        await new Promise<void>(() => {
          // Keep stream unresolved so queued-2 remains pending.
        })
        return {
          id: 'assistant-clear',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'reply',
          createdAt: new Date().toISOString(),
        }
      }
    ) as typeof api.sendMessage

    await useChatStore
      .getState()
      .sendMessage('queued-1', undefined, undefined, false, undefined, 'typed')
    await useChatStore
      .getState()
      .sendMessage('queued-2', undefined, undefined, false, undefined, 'typed')
    await new Promise((resolve) => setTimeout(resolve, 0))

    const preClear = useChatStore.getState()
    const preClearQueue = preClear.activeSessionId
      ? (preClear.queueBySession[preClear.activeSessionId] ?? [])
      : []
    expect(preClearQueue.some((item) => item.status === 'queued')).toBe(true)

    useChatStore.getState().clearQueue()

    const postClear = useChatStore.getState()
    const activeQueue = postClear.activeSessionId
      ? (postClear.queueBySession[postClear.activeSessionId] ?? [])
      : []
    expect(
      activeQueue.some((item) => item.status === 'queued' || item.status === 'paused_vin')
    ).toBe(false)
  })

  it('removeQueuedMessage removes a queued item from the session queue', () => {
    const createdAt = new Date().toISOString()
    useChatStore.setState({
      ...baseState,
      activeSessionId: 'session-1',
      queueBySession: {
        'session-1': [
          {
            id: 'q-1',
            sessionId: 'session-1',
            source: 'typed',
            payload: { content: 'first' },
            status: 'queued',
            createdAt,
          },
          {
            id: 'q-2',
            sessionId: 'session-1',
            source: 'typed',
            payload: { content: 'second' },
            status: 'queued',
            createdAt,
          },
        ],
      },
    })

    useChatStore.getState().removeQueuedMessage('q-1')

    const queue = useChatStore.getState().queueBySession['session-1'] ?? []
    expect(queue).toHaveLength(1)
    expect(queue[0].id).toBe('q-2')
  })

  it('removeQueuedMessage does not remove an active/dispatching item', () => {
    const createdAt = new Date().toISOString()
    useChatStore.setState({
      ...baseState,
      activeSessionId: 'session-1',
      queueBySession: {
        'session-1': [
          {
            id: 'q-active',
            sessionId: 'session-1',
            source: 'typed',
            payload: { content: 'active msg' },
            status: 'active',
            createdAt,
          },
        ],
      },
    })

    useChatStore.getState().removeQueuedMessage('q-active')

    const queue = useChatStore.getState().queueBySession['session-1'] ?? []
    expect(queue).toHaveLength(1)
    expect(queue[0].id).toBe('q-active')
  })

  it('recoverQueueStall resets a stuck dispatch and re-triggers queue processing', () => {
    const createdAt = new Date().toISOString()
    // Mock _sendMessageImmediate to prevent the re-dispatched item from
    // completing or changing state — we only care that recovery resets the
    // stuck item back to 'queued' and kicks off a new dispatch cycle.
    api.sendMessage = vi.fn(
      async () =>
        new Promise<never>(() => {
          // never resolves — keeps the stream open
        })
    ) as unknown as typeof api.sendMessage

    useChatStore.setState({
      ...baseState,
      activeSessionId: 'session-1',
      isQueueDispatching: true,
      activeQueueItemId: 'q-stuck',
      queueBySession: {
        'session-1': [
          {
            id: 'q-stuck',
            sessionId: 'session-1',
            source: 'typed',
            payload: { content: 'stuck' },
            status: 'dispatching',
            createdAt,
          },
        ],
      },
    })

    useChatStore.getState().recoverQueueStall()

    const state = useChatStore.getState()
    // After recovery, _recheckQueueDispatch immediately picks up the re-queued
    // item, so isQueueDispatching is true again (a new dispatch cycle started).
    expect(state.isQueueDispatching).toBe(true)
    // The re-dispatched item transitions dispatching→active synchronously,
    // so lastQueueEvent reflects the active state, not the intermediate dispatching.
    expect(state.lastQueueEvent).toContain('q-stuck')
  })

  it('startEditUserMessage is blocked when queue has pending items', () => {
    const serverId = '00000000-0000-4000-8000-000000000099'
    const createdAt = new Date().toISOString()
    useChatStore.setState({
      ...baseState,
      activeSessionId: 'session-1',
      messages: [
        {
          id: serverId,
          sessionId: 'session-1',
          role: 'user',
          content: 'Hello',
          createdAt,
        },
      ],
      queueBySession: {
        'session-1': [
          {
            id: 'q-pending',
            sessionId: 'session-1',
            source: 'typed',
            payload: { content: 'pending' },
            status: 'queued',
            createdAt,
          },
        ],
      },
    })

    useChatStore.getState().startEditUserMessage(serverId)

    expect(useChatStore.getState().editingUserMessageId).toBeNull()
  })
})
