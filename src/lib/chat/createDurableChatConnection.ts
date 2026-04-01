import { durableStreamConnection } from '@durable-streams/tanstack-ai-transport'

export function createDurableChatConnection(options: {
  docKey: string
  sessionId?: string
  initialOffset?: string
  getSendData?: () => unknown
}): ReturnType<typeof durableStreamConnection> {
  const { docKey, sessionId = 'default', initialOffset, getSendData } = options
  const q = new URLSearchParams({ docKey, sessionId })
  const connection = durableStreamConnection({
    sendUrl: `/api/chat?${q}`,
    readUrl: `/api/chat-stream?${q}`,
    initialOffset,
  })
  return {
    ...connection,
    async send(messages, data, abortSignal) {
      const injectedData = getSendData?.()
      const nextData =
        injectedData && typeof injectedData === 'object'
          ? {
              ...(data && typeof data === 'object' ? (data as Record<string, unknown>) : {}),
              ...(injectedData as Record<string, unknown>),
            }
          : data
      return connection.send(messages, nextData, abortSignal)
    },
  }
}
