import { createFileRoute } from '@tanstack/react-router'
import {
  toDurableChatSessionResponse,
} from '@durable-streams/tanstack-ai-transport'
import type { DurableSessionMessage } from '@durable-streams/tanstack-ai-transport'
import {
  chatSessionStreamPath,
  durableStreamResourceUrl,
  getDurableStreamsOriginServer,
} from '../../lib/yjs/streamIds'
import { runServerAgentSession } from '../../lib/agent/serverAgentSessionController'

function parseChatBody(json: unknown): {
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

function latestUserMessage(messages: DurableSessionMessage[]): DurableSessionMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role === 'user') {
      return m
    }
  }
  return null
}

function lastUserText(messages: DurableSessionMessage[]): string {
  const message = latestUserMessage(messages)
  if (!message) return ''
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

async function* agentResponseStream(input: {
  docKey: string
  sessionId: string
  mode: 'continue' | 'insert' | 'rewrite'
  prompt: string
  runAgent: boolean
}): AsyncIterable<Record<string, unknown>> {
  if (!input.runAgent) return

  const runId = crypto.randomUUID()
  yield {
    type: 'RUN_STARTED',
    runId,
  }

  try {
    const result = await runServerAgentSession({
      docKey: input.docKey,
      sessionId: input.sessionId,
      mode: input.mode,
      prompt: input.prompt,
    })

    if (!result.assistantText) return

    const messageId = crypto.randomUUID()
    const timestamp = Date.now()
    yield {
      type: 'TEXT_MESSAGE_START',
      messageId,
      role: 'assistant',
      model: 'electra',
      timestamp,
    }
    yield {
      type: 'TEXT_MESSAGE_CONTENT',
      messageId,
      delta: result.assistantText,
      model: 'electra',
      timestamp,
    }
    yield {
      type: 'TEXT_MESSAGE_END',
      messageId,
      model: 'electra',
      timestamp,
    }
    yield {
      type: 'RUN_FINISHED',
      runId,
      finishReason: result.cancelled ? 'stop' : 'stop',
    }
  } catch (error) {
    yield {
      type: 'RUN_ERROR',
      runId,
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    }
    console.error('[chat] agent response stream failed', error)
  }
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

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({
        request,
      }: {
        request: Request
      }) => {
        const url = new URL(request.url)
        const docKey = url.searchParams.get('docKey')
        const sessionId = url.searchParams.get('sessionId') ?? 'default'
        if (!docKey) {
          return Response.json({ error: 'docKey is required' }, { status: 400 })
        }

        let body: unknown
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const { messages, runAgent, agentMode } = parseChatBody(body)
        const origin = getDurableStreamsOriginServer()
        const streamPath = chatSessionStreamPath(docKey, sessionId)
        const writeUrl = durableStreamResourceUrl(origin, streamPath)

        const latestUser = latestUserMessage(messages)
        const newMessages = latestUser ? [latestUser] : []

        return toDurableChatSessionResponse({
          stream: {
            writeUrl,
            createIfMissing: true,
          },
          newMessages,
          responseStream: agentResponseStream({
            docKey,
            sessionId,
            mode: agentMode,
            prompt: lastUserText(messages),
            runAgent,
          }),
        })
      },
    },
  },
} as never)
