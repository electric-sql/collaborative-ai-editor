import { createFileRoute } from '@tanstack/react-router'
import { sanitizeDocKey, sanitizeSessionId } from '../../../lib/yjs/streamIds'
import {
  runServerAgentSession,
  type AgentRunMode,
} from '../../../lib/agent/serverAgentSessionController'
import {
  attachAgentRunAbort,
  releaseAgentRunAbort,
} from '../../../lib/agent/agentRunCancellation'

function parseBody(json: unknown):
  | { ok: true; value: ParsedRunBody }
  | { ok: false; error: string } {
  if (!json || typeof json !== 'object') {
    return { ok: false, error: 'Expected JSON object' }
  }
  const o = json as Record<string, unknown>
  const docKey = typeof o.docKey === 'string' ? o.docKey : null
  const modeRaw = o.mode
  const mode: AgentRunMode =
    modeRaw === 'continue' || modeRaw === 'insert' || modeRaw === 'rewrite' ? modeRaw : 'continue'
  const prompt = typeof o.prompt === 'string' ? o.prompt : typeof o.input === 'string' ? o.input : ''
  const sessionId = typeof o.sessionId === 'string' ? o.sessionId : 'default'
  const cursorAnchor = typeof o.cursorAnchor === 'number' ? o.cursorAnchor : undefined
  const cursorHead = typeof o.cursorHead === 'number' ? o.cursorHead : undefined
  const insertAnchorB64 = typeof o.insertAnchorB64 === 'string' ? o.insertAnchorB64 : undefined
  const rewriteStartB64 = typeof o.rewriteStartB64 === 'string' ? o.rewriteStartB64 : undefined
  const rewriteEndB64 = typeof o.rewriteEndB64 === 'string' ? o.rewriteEndB64 : undefined

  if (!docKey) {
    return { ok: false, error: 'docKey is required' }
  }

  try {
    sanitizeDocKey(docKey)
    sanitizeSessionId(sessionId)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Invalid id' }
  }

  return {
    ok: true,
    value: {
      docKey,
      sessionId,
      mode,
      prompt,
      cursorAnchor,
      cursorHead,
      insertAnchorB64,
      rewriteStartB64,
      rewriteEndB64,
    },
  }
}

interface ParsedRunBody {
  docKey: string
  sessionId: string
  mode: AgentRunMode
  prompt: string
  cursorAnchor?: number
  cursorHead?: number
  insertAnchorB64?: string
  rewriteStartB64?: string
  rewriteEndB64?: string
}

export const Route = createFileRoute('/api/agent/run')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const parsed = parseBody(body)
        if (!parsed.ok) {
          return Response.json({ error: parsed.error }, { status: 400 })
        }

        const {
          docKey,
          sessionId,
          mode,
          prompt,
          cursorAnchor,
          cursorHead,
          insertAnchorB64,
          rewriteStartB64,
          rewriteEndB64,
        } = parsed.value

        const signal = attachAgentRunAbort(sessionId)
        try {
          const result = await runServerAgentSession({
            docKey,
            sessionId,
            mode,
            prompt,
            cursorAnchor,
            cursorHead,
            insertAnchorB64,
            rewriteStartB64,
            rewriteEndB64,
            signal,
          })
          return Response.json(result, {
            status: 200,
            headers: { 'Cache-Control': 'no-store' },
          })
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Agent run failed'
          return Response.json({ error: message }, { status: 500 })
        } finally {
          releaseAgentRunAbort(sessionId)
        }
      },
    },
  },
} as never)
