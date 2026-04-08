import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiClient, setAuthToken } from '@/lib/apiClient'
import { PANEL_UPDATE_MODE } from '@/lib/types'

class FakeXMLHttpRequest {
  static instances: FakeXMLHttpRequest[] = []

  status = 200
  responseText = ''
  timeout = 0
  onprogress: ((event?: unknown) => void) | null = null
  onload: ((event?: unknown) => void) | null = null
  onerror: ((event?: unknown) => void) | null = null
  ontimeout: ((event?: unknown) => void) | null = null
  requestHeaders: Record<string, string> = {}

  open(_method: string, _url: string) {}

  setRequestHeader(name: string, value: string) {
    this.requestHeaders[name] = value
  }

  send(_body?: string) {
    FakeXMLHttpRequest.instances.push(this)
  }

  pushEvent(eventType: string, data: unknown) {
    this.responseText += `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
    this.onprogress?.()
  }

  complete(status = 200) {
    this.status = status
    this.onload?.()
  }

  fail() {
    this.onerror?.()
  }

  expire() {
    this.ontimeout?.()
  }
}

describe('ApiClient.sendMessage', () => {
  const originalXmlHttpRequest = globalThis.XMLHttpRequest

  beforeEach(() => {
    FakeXMLHttpRequest.instances = []
    globalThis.XMLHttpRequest = FakeXMLHttpRequest as unknown as typeof XMLHttpRequest
  })

  afterEach(() => {
    globalThis.XMLHttpRequest = originalXmlHttpRequest
  })

  it('invokes onTextDone before chat-loop onToolResult when tool_result precedes done', async () => {
    const apiClient = new ApiClient()
    const order: string[] = []
    const onToolResult = vi.fn(() => order.push('tool'))
    const onTextDone = vi.fn(() => order.push('done'))

    const sendPromise = apiClient.sendMessage(
      'session-order',
      'Hi',
      undefined,
      undefined,
      onToolResult,
      onTextDone
    )

    const xhr = FakeXMLHttpRequest.instances.at(-1)
    xhr?.pushEvent('tool_result', { tool: 'set_vehicle', data: { vehicle_id: 'v1' } })
    xhr?.pushEvent('text', { chunk: 'Updated.' })
    xhr?.pushEvent('done', { text: 'Updated.' })
    xhr?.complete()

    await sendPromise
    expect(order).toEqual(['done', 'tool'])
  })

  it('streams panel cards and reconciles final panel state', async () => {
    const apiClient = new ApiClient()
    const onToolResult = vi.fn()
    const onTextDone = vi.fn()
    const onPanelStarted = vi.fn()
    const onPanelFinished = vi.fn()

    const sendPromise = apiClient.sendMessage(
      'session-1',
      'Hello',
      undefined,
      undefined,
      onToolResult,
      onTextDone,
      undefined,
      undefined,
      onPanelStarted,
      onPanelFinished
    )

    const xhr = FakeXMLHttpRequest.instances.at(-1)
    expect(xhr).toBeDefined()

    const card = {
      kind: 'notes',
      template: 'notes',
      title: 'What Changed',
      content: { summary: 'Numbers moved.' },
      priority: 'high',
    }

    xhr?.pushEvent('text', { chunk: 'Hello there' })
    xhr?.pushEvent('done', { text: 'Hello there' })
    xhr?.pushEvent('panel_started', {})
    xhr?.pushEvent('panel_card', { index: 0, card })
    xhr?.pushEvent('panel_done', { cards: [card] })
    xhr?.complete()

    await expect(sendPromise).resolves.toMatchObject({
      sessionId: 'session-1',
      role: 'assistant',
      content: 'Hello there',
    })
    expect(onTextDone).toHaveBeenCalledWith('Hello there', undefined, undefined)
    expect(onPanelStarted).toHaveBeenCalledTimes(1)
    expect(onPanelFinished).toHaveBeenCalledTimes(1)
    expect(onToolResult).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        name: 'update_insights_panel',
        args: { mode: PANEL_UPDATE_MODE.APPEND, card, index: 0 },
      })
    )
    expect(onToolResult).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        name: 'update_insights_panel',
        args: { mode: PANEL_UPDATE_MODE.REPLACE, cards: [card] },
      })
    )
  })

  it('finishes panel cleanup when the stream closes without a panel terminal event', async () => {
    const apiClient = new ApiClient()
    const onPanelStarted = vi.fn()
    const onPanelFinished = vi.fn()

    const sendPromise = apiClient.sendMessage(
      'session-2',
      'Hello',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      onPanelStarted,
      onPanelFinished
    )

    const xhr = FakeXMLHttpRequest.instances.at(-1)
    xhr?.pushEvent('panel_started', {})
    xhr?.complete()

    await expect(sendPromise).resolves.toMatchObject({
      sessionId: 'session-2',
      role: 'assistant',
      content: '',
    })
    expect(onPanelStarted).toHaveBeenCalledTimes(1)
    expect(onPanelFinished).toHaveBeenCalledTimes(1)
  })

  it('finishes panel cleanup on panel_error without double-calling the callback', async () => {
    const apiClient = new ApiClient()
    const onPanelFinished = vi.fn()

    const sendPromise = apiClient.sendMessage(
      'session-3',
      'Hello',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      onPanelFinished
    )

    const xhr = FakeXMLHttpRequest.instances.at(-1)
    xhr?.pushEvent('panel_started', {})
    xhr?.pushEvent('panel_error', { message: 'panel failed' })
    xhr?.complete()

    await expect(sendPromise).resolves.toMatchObject({
      sessionId: 'session-3',
      role: 'assistant',
    })
    expect(onPanelFinished).toHaveBeenCalledTimes(1)
  })

  it('maps the done SSE event onto the assistant message', async () => {
    const apiClient = new ApiClient()
    const onTextDone = vi.fn()

    const sendPromise = apiClient.sendMessage(
      'session-table',
      'Compare these',
      undefined,
      undefined,
      undefined,
      onTextDone
    )

    const xhr = FakeXMLHttpRequest.instances.at(-1)
    xhr?.pushEvent('text', { chunk: 'Here is the comparison.' })
    xhr?.pushEvent('done', {
      text: 'Here is the comparison.',
    })
    xhr?.complete()

    await expect(sendPromise).resolves.toMatchObject({
      content: 'Here is the comparison.',
    })
    expect(onTextDone).toHaveBeenCalledWith('Here is the comparison.', undefined, undefined)
  })
})

describe('ApiClient.getMessages', () => {
  afterEach(() => {
    setAuthToken(null)
    vi.unstubAllGlobals()
  })

  it('maps wrapped messages and context_pressure from snake_case JSON', async () => {
    const apiClient = new ApiClient()
    setAuthToken('test-token')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          messages: [
            {
              id: 'm1',
              session_id: 's1',
              role: 'user',
              content: 'hi',
              image_url: null,
              tool_calls: null,
              usage: null,
              created_at: '2026-01-01T00:00:00Z',
            },
          ],
          context_pressure: {
            level: 'warn',
            estimated_input_tokens: 120000,
            input_budget: 180000,
          },
        }),
      })
    )

    const out = await apiClient.getMessages('s1')
    expect(out.messages).toHaveLength(1)
    expect(out.messages[0].sessionId).toBe('s1')
    expect(out.messages[0].content).toBe('hi')
    expect(out.contextPressure.level).toBe('warn')
    expect(out.contextPressure.estimatedInputTokens).toBe(120000)
    expect(out.contextPressure.inputBudget).toBe(180000)
  })
})

describe('ApiClient.sendMessage compaction SSE', () => {
  const originalXmlHttpRequest = globalThis.XMLHttpRequest

  beforeEach(() => {
    FakeXMLHttpRequest.instances = []
    globalThis.XMLHttpRequest = FakeXMLHttpRequest as unknown as typeof XMLHttpRequest
  })

  afterEach(() => {
    globalThis.XMLHttpRequest = originalXmlHttpRequest
  })

  it('invokes onCompaction started then done for compaction events', async () => {
    const apiClient = new ApiClient()
    const phases: string[] = []
    const onCompaction = vi.fn((p: 'started' | 'done' | 'error') => phases.push(p))

    const sendPromise = apiClient.sendMessage(
      'session-c',
      'Hi',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      onCompaction
    )

    const xhr = FakeXMLHttpRequest.instances.at(-1)
    xhr?.pushEvent('compaction_started', { reason: 'input_budget' })
    xhr?.pushEvent('compaction_done', { first_kept_message_id: 'x' })
    xhr?.pushEvent('text', { chunk: 'Hello.' })
    xhr?.pushEvent('done', { text: 'Hello.' })
    xhr?.complete()

    await sendPromise
    expect(onCompaction).toHaveBeenCalledTimes(2)
    expect(phases).toEqual(['started', 'done'])
  })
})
