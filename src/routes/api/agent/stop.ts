import { createFileRoute } from '@tanstack/react-router'
import { sanitizeDocKey, sanitizeSessionId } from '../../../lib/yjs/streamIds'
import { abortAgentRun } from '../../../lib/agent/agentRunCancellation'

export const Route = createFileRoute('/api/agent/stop')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        if (!body || typeof body !== 'object') {
          return Response.json({ error: 'Expected JSON object' }, { status: 400 })
        }
        const o = body as Record<string, unknown>
        const docKey = typeof o.docKey === 'string' ? o.docKey : null
        const sessionId = typeof o.sessionId === 'string' ? o.sessionId : null
        if (!docKey || !sessionId) {
          return Response.json({ error: 'docKey and sessionId are required' }, { status: 400 })
        }
        try {
          sanitizeDocKey(docKey)
          sanitizeSessionId(sessionId)
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : 'Invalid id' }, { status: 400 })
        }
        const aborted = abortAgentRun(docKey, sessionId)
        return Response.json({ ok: true, aborted }, {
          status: 200,
          headers: { 'Cache-Control': 'no-store' },
        })
      },
    },
  },
} as never)
