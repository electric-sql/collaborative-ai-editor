import { createFileRoute } from '@tanstack/react-router'
import { ensureDurableChatSessionStream } from '@durable-streams/tanstack-ai-transport'
import {
  chatSessionStreamPath,
  durableStreamResourceUrl,
  getDurableStreamsOriginServer,
} from '../../lib/yjs/streamIds'

const DS_FORWARD_PARAMS = ['offset', 'live', 'cursor'] as const

export const Route = createFileRoute('/api/chat-stream')({
  server: {
    handlers: {
      GET: async ({
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

        const origin = getDurableStreamsOriginServer()
        const streamPath = chatSessionStreamPath(docKey, sessionId)
        const writeUrl = durableStreamResourceUrl(origin, streamPath)

        // Ensure first-time subscribers don't get 404 before any message is sent.
        await ensureDurableChatSessionStream({
          writeUrl,
          createIfMissing: true,
        })

        const upstream = new URL(writeUrl)

        for (const key of DS_FORWARD_PARAMS) {
          const v = url.searchParams.get(key)
          if (v !== null) upstream.searchParams.set(key, v)
        }

        const accept = request.headers.get('Accept')
        const headers = new Headers()
        if (accept) headers.set('Accept', accept)

        return fetch(upstream.toString(), {
          method: 'GET',
          headers,
        })
      },
    },
  },
} as never)
