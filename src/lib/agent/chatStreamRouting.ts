import type { StreamChunk } from '@tanstack/ai'
import type { DurableSessionMessage } from '@durable-streams/tanstack-ai-transport'
import { parseEditorContextPayload, type EditorContextPayload } from './editorContext'

export function textFromDurableMessage(message: DurableSessionMessage): string {
  const parts = message.parts ?? []
  const chunks: string[] = []
  for (const p of parts) {
    if (p.type === 'text' && typeof p.content === 'string') {
      chunks.push(p.content)
    } else if (p.type === 'text' && typeof p.text === 'string') {
      chunks.push(p.text)
    }
  }
  return chunks.join('')
}

export function toModelMessages(messages: DurableSessionMessage[]) {
  return messages.flatMap((message) => {
    if (message.role === 'tool') {
      return []
    }
    const content = textFromDurableMessage(message)
    return [{ role: message.role, content }]
  })
}

export function parseChatBody(json: unknown): {
  messages: DurableSessionMessage[]
  runAgent: boolean
  agentMode: 'continue' | 'insert' | 'rewrite'
  editorContext?: EditorContextPayload
} {
  if (!json || typeof json !== 'object') {
    return { messages: [], runAgent: true, agentMode: 'continue' }
  }
  const o = json as {
    messages?: unknown
    runAgent?: unknown
    agentMode?: unknown
    data?: unknown
  }
  const data =
    o.data && typeof o.data === 'object' ? (o.data as Record<string, unknown>) : undefined
  const messagesRaw = o.messages
  if (!Array.isArray(messagesRaw)) {
    return { messages: [], runAgent: true, agentMode: 'continue' }
  }
  const messages: DurableSessionMessage[] = []
  for (const item of messagesRaw) {
    const m = normalizeIncomingMessage(item)
    if (m) messages.push(m)
  }
  const runAgent =
    typeof data?.runAgent === 'boolean'
      ? data.runAgent
      : typeof o.runAgent === 'boolean'
        ? o.runAgent
        : true
  const agentMode =
    data?.agentMode === 'insert' ||
    data?.agentMode === 'rewrite' ||
    data?.agentMode === 'continue'
      ? data.agentMode
      : o.agentMode === 'insert' || o.agentMode === 'rewrite' || o.agentMode === 'continue'
        ? o.agentMode
      : 'continue'
  const editorContext = parseEditorContextPayload(data?.editorContext)
  return { messages, runAgent, agentMode, ...(editorContext ? { editorContext } : {}) }
}

function normalizeIncomingMessage(item: unknown): DurableSessionMessage | null {
  if (!item || typeof item !== 'object') return null
  const o = item as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id : undefined
  const role =
    o.role === 'user' || o.role === 'assistant' || o.role === 'system' || o.role === 'tool'
      ? o.role
      : 'user'

  if (Array.isArray(o.parts)) {
    return {
      id,
      role,
      parts: o.parts as DurableSessionMessage['parts'],
    }
  }

  if (typeof o.content === 'string') {
    return {
      id,
      role,
      parts: [{ type: 'text', content: o.content }],
    }
  }

  return {
    id,
    role,
    parts: [],
  }
}

export interface StreamingEditRouter {
  isStreamingEditActive(): boolean
  pushStreamingText(delta: string): Promise<void>
  stopStreamingEdit(cancelled?: boolean): { ok: true; committedChars: number; cancelled?: boolean }
  getActiveStreamingEditInfo?: () => { mode: string; contentFormat?: string } | null
}

export async function* routeAgentStreamChunks(
  stream: AsyncIterable<StreamChunk>,
  runtime: StreamingEditRouter,
): AsyncIterable<StreamChunk> {
  let suppressedMessageId: string | null = null

  for await (const chunk of stream) {
    if (chunk.type === 'TEXT_MESSAGE_START' && chunk.role === 'assistant') {
      if (runtime.isStreamingEditActive()) {
        suppressedMessageId = chunk.messageId
        const info = runtime.getActiveStreamingEditInfo?.() ?? null
        yield {
          type: 'CUSTOM',
          timestamp: chunk.timestamp,
          model: chunk.model,
          name: 'streaming-insert-start',
          value: {
            messageId: chunk.messageId,
            ...(info ? info : {}),
          },
        }
        continue
      }
      yield chunk
      continue
    }

    if (chunk.type === 'TEXT_MESSAGE_CONTENT' && chunk.messageId === suppressedMessageId) {
      await runtime.pushStreamingText(chunk.delta)
      yield {
        type: 'CUSTOM',
        timestamp: chunk.timestamp,
        model: chunk.model,
        name: 'streaming-insert-delta',
        value: {
          messageId: chunk.messageId,
          delta: chunk.delta,
        },
      }
      continue
    }

    if (
      (chunk.type === 'TOOL_CALL_START' || chunk.type === 'RUN_FINISHED' || chunk.type === 'RUN_ERROR') &&
      suppressedMessageId !== null
    ) {
      const result = runtime.stopStreamingEdit(chunk.type === 'RUN_ERROR')
      yield {
        type: 'CUSTOM',
        timestamp: chunk.timestamp,
        model: chunk.model,
        name: 'streaming-insert-end',
        value: {
          messageId: suppressedMessageId,
          ...result,
        },
      }
      suppressedMessageId = null
    }

    if (chunk.type === 'TEXT_MESSAGE_END' && chunk.messageId === suppressedMessageId) {
      const result = runtime.stopStreamingEdit(false)
      yield {
        type: 'CUSTOM',
        timestamp: chunk.timestamp,
        model: chunk.model,
        name: 'streaming-insert-end',
        value: {
          messageId: suppressedMessageId,
          ...result,
        },
      }
      suppressedMessageId = null
      continue
    }

    yield chunk
  }
}
