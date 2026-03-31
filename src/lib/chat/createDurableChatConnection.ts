import { durableStreamConnection } from '@durable-streams/tanstack-ai-transport'

export function createDurableChatConnection(options: {
  docKey: string
  sessionId?: string
  initialOffset?: string
}): ReturnType<typeof durableStreamConnection> {
  const { docKey, sessionId = 'default', initialOffset } = options
  const q = new URLSearchParams({ docKey, sessionId })
  return durableStreamConnection({
    sendUrl: `/api/chat?${q}`,
    readUrl: `/api/chat-stream?${q}`,
    initialOffset,
  })
}
