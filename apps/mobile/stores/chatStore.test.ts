import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import type { Message, QuickAction, Session, VinAssistItem } from '@/lib/types'
import { normalizeVinCandidate, normalizeVinCandidates, useChatStore } from '@/stores/chatStore'

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
  const originalGetSessions = api.getSessions
  const originalPersistUserMessage = api.persistUserMessage

  beforeEach(() => {
    useChatStore.setState(baseState)
    api.getSessions = vi.fn().mockResolvedValue([])
  })

  afterEach(() => {
    api.sendMessage = originalSendMessage
    api.getSessions = originalGetSessions
    api.persistUserMessage = originalPersistUserMessage
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
    expect(state.vinAssistItems.every((i) => i.sourceMessageId === persistedId)).toBe(true)
    const vins = state.vinAssistItems.map((i) => i.vin).sort()
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
})
