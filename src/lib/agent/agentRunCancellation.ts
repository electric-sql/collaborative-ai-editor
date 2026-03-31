/** One active agent run per session id; new runs abort the previous controller. */

const controllers = new Map<string, AbortController>()

export function attachAgentRunController(sessionId: string): AbortController {
  controllers.get(sessionId)?.abort()
  const next = new AbortController()
  controllers.set(sessionId, next)
  return next
}

export function attachAgentRunAbort(sessionId: string): AbortSignal {
  return attachAgentRunController(sessionId).signal
}

export function releaseAgentRunAbort(sessionId: string): void {
  controllers.delete(sessionId)
}

export function abortAgentRun(sessionId: string): boolean {
  const c = controllers.get(sessionId)
  if (!c) return false
  c.abort()
  controllers.delete(sessionId)
  return true
}
