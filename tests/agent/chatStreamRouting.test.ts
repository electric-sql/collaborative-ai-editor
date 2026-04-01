import { describe, expect, it } from 'vitest'
import type { StreamChunk } from '@tanstack/ai'
import {
  parseChatBody,
  routeAgentStreamChunks,
  textFromDurableMessage,
  toModelMessages,
  type StreamingEditRouter,
} from '../../src/lib/agent/chatStreamRouting'

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const chunk of stream) out.push(chunk)
  return out
}

function createRouterStub(initiallyActive = false): StreamingEditRouter & {
  pushed: string[]
  stops: boolean[]
  setActive(next: boolean): void
} {
  let active = initiallyActive
  const pushed: string[] = []
  const stops: boolean[] = []
  return {
    pushed,
    stops,
    setActive(next: boolean) {
      active = next
    },
    isStreamingEditActive() {
      return active
    },
    async pushStreamingText(delta: string) {
      pushed.push(delta)
    },
    stopStreamingEdit(cancelled?: boolean) {
      stops.push(Boolean(cancelled))
      active = false
      return { ok: true, committedChars: pushed.join('').length, ...(cancelled ? { cancelled: true } : {}) }
    },
    getActiveStreamingEditInfo() {
      return active ? { mode: 'insert', contentFormat: 'plain_text' } : null
    },
  }
}

describe('chat stream routing unit tests', () => {
  it('parses chat body defaults and normalizes messages', () => {
    expect(parseChatBody(null)).toEqual({
      messages: [],
      runAgent: true,
      agentMode: 'continue',
    })

    expect(
      parseChatBody({
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', parts: [{ type: 'text', text: 'hi' }] },
        ],
        data: { runAgent: false, agentMode: 'rewrite' },
      }),
    ).toEqual({
      messages: [
        { role: 'user', parts: [{ type: 'text', content: 'hello' }] },
        { role: 'assistant', parts: [{ type: 'text', text: 'hi' }] },
      ],
      runAgent: false,
      agentMode: 'rewrite',
    })
  })

  it('extracts message text and filters tool messages from model input', () => {
    const messages = [
      { role: 'user', parts: [{ type: 'text', content: 'hello ' }, { type: 'text', text: 'world' }] },
      { role: 'tool', content: 'ignored' },
      { role: 'assistant', parts: [{ type: 'text', content: 'done' }] },
    ] as any

    expect(textFromDurableMessage(messages[0])).toBe('hello world')
    expect(toModelMessages(messages as any)).toEqual([
      { role: 'user', content: 'hello world' },
      { role: 'assistant', content: 'done' },
    ])
  })

  it('passes through normal assistant chat chunks when no streaming edit is active', async () => {
    const runtime = createRouterStub(false)
    const chunks: StreamChunk[] = [
      { type: 'TEXT_MESSAGE_START', timestamp: 1, messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', timestamp: 2, messageId: 'm1', delta: 'hello' },
      { type: 'TEXT_MESSAGE_END', timestamp: 3, messageId: 'm1' },
    ]

    const yielded = await collect(routeAgentStreamChunks((async function* () { yield* chunks })(), runtime))

    expect(yielded).toEqual(chunks)
    expect(runtime.pushed).toEqual([])
    expect(runtime.stops).toEqual([])
  })

  it('suppresses assistant text into the document while streaming edit is active', async () => {
    const runtime = createRouterStub(true)
    const chunks: StreamChunk[] = [
      { type: 'TEXT_MESSAGE_START', timestamp: 1, messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', timestamp: 2, messageId: 'm1', delta: 'Once ' },
      { type: 'TEXT_MESSAGE_CONTENT', timestamp: 3, messageId: 'm1', delta: 'upon a time' },
      { type: 'TEXT_MESSAGE_END', timestamp: 4, messageId: 'm1' },
      { type: 'TEXT_MESSAGE_START', timestamp: 5, messageId: 'm2', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', timestamp: 6, messageId: 'm2', delta: 'Done.' },
      { type: 'TEXT_MESSAGE_END', timestamp: 7, messageId: 'm2' },
    ]

    const yielded = await collect(routeAgentStreamChunks((async function* () { yield* chunks })(), runtime))

    expect(runtime.pushed).toEqual(['Once ', 'upon a time'])
    expect(runtime.stops).toEqual([false])
    expect(yielded).toEqual([
      {
        type: 'CUSTOM',
        timestamp: 1,
        model: undefined,
        name: 'streaming-insert-start',
        value: { messageId: 'm1', mode: 'insert', contentFormat: 'plain_text' },
      },
      {
        type: 'CUSTOM',
        timestamp: 2,
        model: undefined,
        name: 'streaming-insert-delta',
        value: { messageId: 'm1', delta: 'Once ' },
      },
      {
        type: 'CUSTOM',
        timestamp: 3,
        model: undefined,
        name: 'streaming-insert-delta',
        value: { messageId: 'm1', delta: 'upon a time' },
      },
      {
        type: 'CUSTOM',
        timestamp: 4,
        model: undefined,
        name: 'streaming-insert-end',
        value: { messageId: 'm1', ok: true, committedChars: 'Once upon a time'.length },
      },
      ...chunks.slice(4),
    ])
  })

  it('stops a suppressed streaming edit on tool call boundaries and yields the tool call', async () => {
    const runtime = createRouterStub(true)
    const chunks: StreamChunk[] = [
      { type: 'TEXT_MESSAGE_START', timestamp: 1, messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', timestamp: 2, messageId: 'm1', delta: 'draft' },
      { type: 'TOOL_CALL_START', timestamp: 3, toolCallId: 't1', toolName: 'stop_streaming_edit' },
    ]

    const yielded = await collect(routeAgentStreamChunks((async function* () { yield* chunks })(), runtime))

    expect(runtime.pushed).toEqual(['draft'])
    expect(runtime.stops).toEqual([false])
    expect(yielded).toEqual([
      {
        type: 'CUSTOM',
        timestamp: 1,
        model: undefined,
        name: 'streaming-insert-start',
        value: { messageId: 'm1', mode: 'insert', contentFormat: 'plain_text' },
      },
      {
        type: 'CUSTOM',
        timestamp: 2,
        model: undefined,
        name: 'streaming-insert-delta',
        value: { messageId: 'm1', delta: 'draft' },
      },
      {
        type: 'CUSTOM',
        timestamp: 3,
        model: undefined,
        name: 'streaming-insert-end',
        value: { messageId: 'm1', ok: true, committedChars: 'draft'.length },
      },
      chunks[2]!,
    ])
  })

  it('marks suppression as cancelled on run errors', async () => {
    const runtime = createRouterStub(true)
    const chunks: StreamChunk[] = [
      { type: 'TEXT_MESSAGE_START', timestamp: 1, messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', timestamp: 2, messageId: 'm1', delta: 'partial' },
      { type: 'RUN_ERROR', timestamp: 3, error: { message: 'boom' } },
    ]

    const yielded = await collect(routeAgentStreamChunks((async function* () { yield* chunks })(), runtime))

    expect(runtime.pushed).toEqual(['partial'])
    expect(runtime.stops).toEqual([true])
    expect(yielded).toEqual([
      {
        type: 'CUSTOM',
        timestamp: 1,
        model: undefined,
        name: 'streaming-insert-start',
        value: { messageId: 'm1', mode: 'insert', contentFormat: 'plain_text' },
      },
      {
        type: 'CUSTOM',
        timestamp: 2,
        model: undefined,
        name: 'streaming-insert-delta',
        value: { messageId: 'm1', delta: 'partial' },
      },
      {
        type: 'CUSTOM',
        timestamp: 3,
        model: undefined,
        name: 'streaming-insert-end',
        value: { messageId: 'm1', ok: true, committedChars: 'partial'.length, cancelled: true },
      },
      chunks[2]!,
    ])
  })

  it('does not synthesize a summary when tool-only document edits finish without assistant text', async () => {
    const runtime = createRouterStub(false)
    const chunks: StreamChunk[] = [
      { type: 'RUN_STARTED', timestamp: 1, runId: 'r1' },
      { type: 'TOOL_CALL_START', timestamp: 2, toolCallId: 't1', toolName: 'insert_text' },
      { type: 'RUN_FINISHED', timestamp: 3, runId: 'r1', finishReason: 'stop' },
    ]

    const yielded = await collect(routeAgentStreamChunks((async function* () { yield* chunks })(), runtime))

    expect(yielded).toEqual(chunks)
  })
})
