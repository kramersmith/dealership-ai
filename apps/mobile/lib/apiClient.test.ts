import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiClient, CLIENT_ABORT_ERROR, setAuthToken } from '@/lib/apiClient'

class FakeXMLHttpRequest {
  static instances: FakeXMLHttpRequest[] = []

  status = 200
  responseText = ''
  timeout = 0
  method = ''
  url = ''
  requestBody: string | undefined = undefined
  onprogress: ((event?: unknown) => void) | null = null
  onload: ((event?: unknown) => void) | null = null
  onerror: ((event?: unknown) => void) | null = null
  onabort: ((event?: unknown) => void) | null = null
  ontimeout: ((event?: unknown) => void) | null = null
  requestHeaders: Record<string, string> = {}

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.requestHeaders[name] = value
  }

  send(body?: string) {
    this.requestBody = body
    FakeXMLHttpRequest.instances.push(this)
  }

  abort() {
    this.onabort?.()
  }

  pushEvent(eventType: string, data: unknown) {
    this.responseText += `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
    this.onprogress?.()
  }

  pushRaw(rawChunk: string) {
    this.responseText += rawChunk
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

    const streamRequest = FakeXMLHttpRequest.instances.at(-1)
    streamRequest?.pushEvent('tool_result', { tool: 'set_vehicle', data: { vehicle_id: 'v1' } })
    streamRequest?.pushEvent('text', { chunk: 'Updated.' })
    streamRequest?.pushEvent('done', { text: 'Updated.' })
    streamRequest?.complete()

    await sendPromise
    expect(order).toEqual(['done', 'tool'])
  })

  it('applies panel_done as a single atomic update before onPanelFinished', async () => {
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

    const streamRequest = FakeXMLHttpRequest.instances.at(-1)
    expect(streamRequest).toBeDefined()

    const card = {
      kind: 'notes',
      template: 'notes',
      title: 'What Changed',
      content: { summary: 'Numbers moved.' },
      priority: 'high',
    }

    streamRequest?.pushEvent('text', { chunk: 'Hello there' })
    streamRequest?.pushEvent('done', { text: 'Hello there' })
    streamRequest?.pushEvent('panel_started', {})
    streamRequest?.pushEvent('panel_done', {
      cards: [card],
      assistant_message_id: 'assistant-msg-uuid',
    })
    streamRequest?.complete()

    await expect(sendPromise).resolves.toMatchObject({
      sessionId: 'session-1',
      role: 'assistant',
      content: 'Hello there',
    })
    expect(onTextDone).toHaveBeenCalledWith('Hello there', undefined, undefined)
    expect(onPanelStarted).toHaveBeenCalledTimes(1)
    expect(onPanelFinished).toHaveBeenCalledTimes(1)
    expect(onToolResult).toHaveBeenCalledTimes(1)
    expect(onToolResult).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'update_insights_panel',
        args: { cards: [card], assistantMessageId: 'assistant-msg-uuid' },
      })
    )
    expect(onToolResult.mock.invocationCallOrder[0]).toBeLessThan(
      onPanelFinished.mock.invocationCallOrder[0]!
    )
  })

  it('calls onPanelStarted when the first panel event is panel_done (no panel_started)', async () => {
    const apiClient = new ApiClient()
    const onToolResult = vi.fn()
    const onTextDone = vi.fn()
    const onPanelStarted = vi.fn()
    const onPanelFinished = vi.fn()

    const sendPromise = apiClient.sendMessage(
      'session-panel-done-first',
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

    const streamRequest = FakeXMLHttpRequest.instances.at(-1)
    const card = {
      kind: 'notes',
      template: 'notes',
      title: 'What Changed',
      content: { summary: 'Numbers moved.' },
      priority: 'high',
    }

    streamRequest?.pushEvent('text', { chunk: 'Hello' })
    streamRequest?.pushEvent('done', { text: 'Hello' })
    streamRequest?.pushEvent('panel_done', { cards: [card] })
    streamRequest?.complete()

    await sendPromise
    expect(onPanelStarted).toHaveBeenCalledTimes(1)
    expect(onPanelFinished).toHaveBeenCalledTimes(1)
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

    const streamRequest = FakeXMLHttpRequest.instances.at(-1)
    streamRequest?.pushEvent('panel_started', {})
    streamRequest?.complete()

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

    const streamRequest = FakeXMLHttpRequest.instances.at(-1)
    streamRequest?.pushEvent('panel_started', {})
    streamRequest?.pushEvent('panel_error', { message: 'panel failed' })
    streamRequest?.complete()

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

    const streamRequest = FakeXMLHttpRequest.instances.at(-1)
    streamRequest?.pushEvent('text', { chunk: 'Here is the comparison.' })
    streamRequest?.pushEvent('done', {
      text: 'Here is the comparison.',
    })
    streamRequest?.complete()

    await expect(sendPromise).resolves.toMatchObject({
      content: 'Here is the comparison.',
    })
    expect(onTextDone).toHaveBeenCalledWith('Here is the comparison.', undefined, undefined)
  })

  it('forwards turn_started and interrupted events', async () => {
    const apiClient = new ApiClient()
    const onTurnStarted = vi.fn()
    const onInterrupted = vi.fn()

    const sendPromise = apiClient.sendMessage(
      'session-stop',
      'Hi',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      onTurnStarted,
      onInterrupted
    )

    const streamRequest = FakeXMLHttpRequest.instances.at(-1)
    streamRequest?.pushEvent('turn_started', { turn_id: 'turn-1' })
    streamRequest?.pushEvent('text', { chunk: 'Partial text' })
    streamRequest?.pushEvent('interrupted', {
      text: 'Partial text',
      reason: 'user_stop',
      assistant_message_id: 'assistant-stop-1',
    })
    streamRequest?.complete()

    await expect(sendPromise).resolves.toMatchObject({
      id: 'assistant-stop-1',
      content: 'Partial text',
      completionStatus: 'interrupted',
      interruptedReason: 'user_stop',
    })
    expect(onTurnStarted).toHaveBeenCalledWith({ turnId: 'turn-1' })
    expect(onInterrupted).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Partial text',
        reason: 'user_stop',
        assistantMessageId: 'assistant-stop-1',
      })
    )
  })

  it('forwards panel_interrupted and finishes panel state once', async () => {
    const apiClient = new ApiClient()
    const onPanelStarted = vi.fn()
    const onPanelFinished = vi.fn()
    const onPanelInterrupted = vi.fn()

    const sendPromise = apiClient.sendMessage(
      'session-panel-stop',
      'Hello',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      onPanelStarted,
      onPanelFinished,
      undefined,
      undefined,
      undefined,
      onPanelInterrupted
    )

    const streamRequest = FakeXMLHttpRequest.instances.at(-1)
    streamRequest?.pushEvent('done', { text: 'Hello' })
    streamRequest?.pushEvent('panel_started', {})
    streamRequest?.pushEvent('panel_interrupted', { reason: 'user_stop' })
    streamRequest?.complete()

    await sendPromise
    expect(onPanelStarted).toHaveBeenCalledTimes(1)
    expect(onPanelFinished).toHaveBeenCalledTimes(1)
    expect(onPanelInterrupted).toHaveBeenCalledWith({ reason: 'user_stop' })
  })

  it('branchFromUserMessage posts to the branch endpoint and reuses the SSE parser', async () => {
    const apiClient = new ApiClient()
    const onTextDone = vi.fn()

    const sendPromise = apiClient.branchFromUserMessage(
      'session-branch',
      'message-anchor',
      'Edited question',
      undefined,
      undefined,
      undefined,
      onTextDone
    )

    const streamRequest = FakeXMLHttpRequest.instances.at(-1)
    expect(streamRequest?.method).toBe('POST')
    expect(streamRequest?.url).toContain('/chat/session-branch/messages/message-anchor/branch')
    expect(streamRequest?.requestBody).toBe(
      JSON.stringify({ content: 'Edited question', image_url: null })
    )

    streamRequest?.pushEvent('text', { chunk: 'Branched reply' })
    streamRequest?.pushEvent('done', { text: 'Branched reply' })
    streamRequest?.complete()

    await expect(sendPromise).resolves.toMatchObject({
      sessionId: 'session-branch',
      content: 'Branched reply',
    })
    expect(onTextDone).toHaveBeenCalledWith('Branched reply', undefined, undefined)
  })

  it('preserves backend detail text for non-2xx stream responses', async () => {
    const apiClient = new ApiClient()

    const sendPromise = apiClient.sendMessage('session-error', 'Hello')

    const streamRequest = FakeXMLHttpRequest.instances.at(-1)
    expect(streamRequest).toBeDefined()

    streamRequest!.responseText = JSON.stringify({ detail: 'Branch anchor must be a user message' })
    streamRequest?.complete(422)

    await expect(sendPromise).rejects.toThrow('Branch anchor must be a user message')
  })

  it('does not expose raw server error bodies for 5xx stream responses', async () => {
    const apiClient = new ApiClient()

    const sendPromise = apiClient.sendMessage('session-error', 'Hello')

    const streamRequest = FakeXMLHttpRequest.instances.at(-1)
    expect(streamRequest).toBeDefined()

    streamRequest!.responseText = 'Traceback: database password leaked in upstream error'
    streamRequest?.complete(500)

    await expect(sendPromise).rejects.toThrow('Chat API 500')
  })

  it('does not expose raw plain-text bodies for 4xx stream responses', async () => {
    const apiClient = new ApiClient()

    const sendPromise = apiClient.sendMessage('session-error', 'Hello')

    const streamRequest = FakeXMLHttpRequest.instances.at(-1)
    expect(streamRequest).toBeDefined()

    streamRequest!.responseText = 'Traceback: branch anchor leaked in a proxy error page'
    streamRequest?.complete(422)

    await expect(sendPromise).rejects.toThrow('Chat API 422')
  })

  it('rejects malformed SSE payloads before the done event with a protocol error', async () => {
    const apiClient = new ApiClient()

    const sendPromise = apiClient.sendMessage('session-bad-sse', 'Hello')

    const streamRequest = FakeXMLHttpRequest.instances.at(-1)
    expect(streamRequest).toBeDefined()

    streamRequest?.pushRaw('event: text\ndata: {"chunk": "Hello"\n\n')

    await expect(sendPromise).rejects.toThrow('Received an invalid response from the chat service')
  })

  it('ignores malformed post-done SSE payloads and still finishes panel cleanup', async () => {
    const apiClient = new ApiClient()
    const onPanelStarted = vi.fn()
    const onPanelFinished = vi.fn()

    const sendPromise = apiClient.sendMessage(
      'session-post-done-malformed',
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

    const streamRequest = FakeXMLHttpRequest.instances.at(-1)
    expect(streamRequest).toBeDefined()

    streamRequest?.pushEvent('text', { chunk: 'Hello there' })
    streamRequest?.pushEvent('done', { text: 'Hello there' })
    streamRequest?.pushEvent('panel_started', {})
    streamRequest?.pushRaw('event: panel_done\ndata: {"cards":\n\n')
    streamRequest?.complete()

    await expect(sendPromise).resolves.toMatchObject({
      sessionId: 'session-post-done-malformed',
      content: 'Hello there',
    })
    expect(onPanelStarted).toHaveBeenCalledTimes(1)
    expect(onPanelFinished).toHaveBeenCalledTimes(1)
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

describe('ApiClient.persistUserMessage', () => {
  afterEach(() => {
    setAuthToken(null)
    vi.unstubAllGlobals()
  })

  it('POSTs to /chat/{sessionId}/user-message and maps the persisted row to camelCase', async () => {
    const apiClient = new ApiClient()
    setAuthToken('test-token')

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'persisted-123',
        session_id: 'session-vin',
        role: 'user',
        content: 'Compare VINs 1HGBH41JXMN109186 and 2HGFC2F59KH123456',
        image_url: null,
        tool_calls: null,
        usage: null,
        created_at: '2026-01-02T00:00:00Z',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const persisted = await apiClient.persistUserMessage(
      'session-vin',
      'Compare VINs 1HGBH41JXMN109186 and 2HGFC2F59KH123456'
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toContain('/chat/session-vin/user-message')
    expect(calledInit.method).toBe('POST')
    expect(calledInit.body).toBe(
      JSON.stringify({
        content: 'Compare VINs 1HGBH41JXMN109186 and 2HGFC2F59KH123456',
        image_url: null,
      })
    )

    expect(persisted.id).toBe('persisted-123')
    expect(persisted.sessionId).toBe('session-vin')
    expect(persisted.role).toBe('user')
    expect(persisted.content).toBe('Compare VINs 1HGBH41JXMN109186 and 2HGFC2F59KH123456')
  })

  it('forwards imageUri as image_url when provided', async () => {
    const apiClient = new ApiClient()
    setAuthToken('test-token')

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'p2',
        session_id: 's',
        role: 'user',
        content: 'see attached',
        image_url: 'https://img/example.png',
        tool_calls: null,
        usage: null,
        created_at: '2026-01-02T00:00:00Z',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await apiClient.persistUserMessage('s', 'see attached', 'https://img/example.png')

    const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(calledInit.body).toBe(
      JSON.stringify({ content: 'see attached', image_url: 'https://img/example.png' })
    )
  })

  it('preserves structured JSON detail for fetch 4xx responses', async () => {
    const apiClient = new ApiClient()
    setAuthToken('test-token')

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        text: async () =>
          JSON.stringify({ detail: 'Use the branch endpoint to edit earlier history' }),
      })
    )

    await expect(apiClient.persistUserMessage('session-x', 'hello')).rejects.toThrow(
      'Use the branch endpoint to edit earlier history'
    )
  })

  it('does not expose raw plain-text bodies for fetch 4xx responses', async () => {
    const apiClient = new ApiClient()
    setAuthToken('test-token')

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: async () => 'Traceback: raw validation page from an intermediary',
      })
    )

    await expect(apiClient.persistUserMessage('session-x', 'hello')).rejects.toThrow('API 422')
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
    const onCompaction = vi.fn((phase: 'started' | 'done' | 'error') => phases.push(phase))

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

    const streamRequest = FakeXMLHttpRequest.instances.at(-1)
    streamRequest?.pushEvent('compaction_started', { reason: 'input_budget' })
    streamRequest?.pushEvent('compaction_done', { first_kept_message_id: 'x' })
    streamRequest?.pushEvent('text', { chunk: 'Hello.' })
    streamRequest?.pushEvent('done', { text: 'Hello.' })
    streamRequest?.complete()

    await sendPromise
    expect(onCompaction).toHaveBeenCalledTimes(2)
    expect(phases).toEqual(['started', 'done'])
  })
})

describe('ApiClient.stopGeneration / cancelActiveStream', () => {
  const originalXmlHttpRequest = globalThis.XMLHttpRequest

  beforeEach(() => {
    FakeXMLHttpRequest.instances = []
    globalThis.XMLHttpRequest = FakeXMLHttpRequest as unknown as typeof XMLHttpRequest
  })

  afterEach(() => {
    globalThis.XMLHttpRequest = originalXmlHttpRequest
    vi.unstubAllGlobals()
  })

  it('posts stop-turn and maps snake_case response', async () => {
    const apiClient = new ApiClient()
    setAuthToken('test-token')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'cancelled', turn_id: 'turn-1', cancelled: true }),
      })
    )

    const out = await apiClient.stopGeneration('session-1', 'turn-1')
    expect(out).toEqual({ status: 'cancelled', turnId: 'turn-1', cancelled: true })
  })

  it('posts panel-refresh and maps cards payload', async () => {
    const apiClient = new ApiClient()
    setAuthToken('test-token')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          cards: [
            {
              kind: 'notes',
              template: 'notes',
              title: 'x',
              content: { items: [] },
              priority: 'high',
            },
          ],
          assistant_message_id: 'assistant-1',
        }),
      })
    )

    const out = await apiClient.refreshInsightsPanel('session-1')
    expect(out.assistantMessageId).toBe('assistant-1')
    expect(out.cards).toHaveLength(1)
    expect(out.cards[0]?.kind).toBe('notes')
  })

  it('cancels the active stream request for a session', async () => {
    const apiClient = new ApiClient()
    const sendPromise = apiClient.sendMessage('session-cancel', 'hello')
    const streamRequest = FakeXMLHttpRequest.instances.at(-1)
    expect(streamRequest).toBeDefined()

    expect(apiClient.cancelActiveStream('session-cancel')).toBe(true)
    await expect(sendPromise).rejects.toThrow(CLIENT_ABORT_ERROR)
  })
})
