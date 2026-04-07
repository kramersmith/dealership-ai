import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import type { Message, QuickAction, Session, VinAssistItem } from '@/lib/types'
import { useChatStore } from '@/stores/chatStore'

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

describe('useChatStore.sendMessage', () => {
  const originalSendMessage = api.sendMessage
  const originalGetSessions = api.getSessions

  beforeEach(() => {
    useChatStore.setState(baseState)
    api.getSessions = vi.fn().mockResolvedValue([])
  })

  afterEach(() => {
    api.sendMessage = originalSendMessage
    api.getSessions = originalGetSessions
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
