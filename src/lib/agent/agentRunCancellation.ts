/** One active agent run per document/session pair. */

const controllers = new Map<string, AbortController>()

function agentRunKey(docKey: string, sessionId: string): string {
  return `${docKey}\u0000${sessionId}`
}

export function attachAgentRunController(docKey: string, sessionId: string): AbortController {
  const key = agentRunKey(docKey, sessionId)
  controllers.get(key)?.abort()
  const next = new AbortController()
  controllers.set(key, next)
  return next
}

export function attachAgentRunAbort(docKey: string, sessionId: string): AbortSignal {
  return attachAgentRunController(docKey, sessionId).signal
}

export function releaseAgentRunAbort(
  docKey: string,
  sessionId: string,
  controller?: AbortController,
): void {
  const key = agentRunKey(docKey, sessionId)
  const current = controllers.get(key)
  if (!current) return
  if (controller && current !== controller) return
  controllers.delete(key)
}

export function abortAgentRun(docKey: string, sessionId: string): boolean {
  const key = agentRunKey(docKey, sessionId)
  const c = controllers.get(key)
  if (!c) return false
  c.abort()
  controllers.delete(key)
  return true
}
