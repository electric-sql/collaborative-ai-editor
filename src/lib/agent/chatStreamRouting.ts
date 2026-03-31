import type { StreamChunk } from '@tanstack/ai'
import type { DurableSessionMessage } from '@durable-streams/tanstack-ai-transport'

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
  return { messages, runAgent, agentMode }
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
        continue
      }
      yield chunk
      continue
    }

    if (chunk.type === 'TEXT_MESSAGE_CONTENT' && chunk.messageId === suppressedMessageId) {
      await runtime.pushStreamingText(chunk.delta)
      continue
    }

    if (
      (chunk.type === 'TOOL_CALL_START' || chunk.type === 'RUN_FINISHED' || chunk.type === 'RUN_ERROR') &&
      suppressedMessageId !== null
    ) {
      runtime.stopStreamingEdit(chunk.type === 'RUN_ERROR')
      suppressedMessageId = null
    }

    if (chunk.type === 'TEXT_MESSAGE_END' && chunk.messageId === suppressedMessageId) {
      runtime.stopStreamingEdit(false)
      suppressedMessageId = null
      continue
    }

    yield chunk
  }
}
