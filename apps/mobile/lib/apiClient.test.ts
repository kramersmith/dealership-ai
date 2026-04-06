import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiClient } from '@/lib/apiClient'
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
})
