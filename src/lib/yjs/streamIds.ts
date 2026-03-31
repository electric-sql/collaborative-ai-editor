/**
 * Deterministic durable stream paths for each logical document.
 *
 * Yjs collaboration uses `docCollaborationDocId` as the provider `docId`.
 * Presence/cursors use the Yjs awareness channel on the same collaboration stream
 * (`?awareness=<name>`); `@durable-streams/y-durable-streams` currently uses `default`.
 * Chat sessions (TanStack AI transport) use `chatSessionStreamPath(docKey, sessionId)`.
 */

const YJS_DOC_ROOT = 'rooms'
const CHAT_ROOT = 'docs'
const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}
const DOC_LAYOUT_VERSION =
  viteEnv.VITE_YJS_DOC_LAYOUT_VERSION?.trim() || 'v3'

/** HTTP path segment for `/v1/yjs/:service` (see `durableStreamsYjsBaseUrl`). */
export const YJS_SERVICE_NAME =
  viteEnv.VITE_YJS_SERVICE_NAME?.trim() || 'y-llm-demo-v2'

export function sanitizeDocKey(docKey: string): string {
  if (docKey.includes('/') || docKey.includes('?') || docKey.includes('#')) {
    throw new Error('docKey must not contain /, ?, or #')
  }
  return docKey
}

export function sanitizeSessionId(sessionId: string): string {
  if (sessionId.includes('/') || sessionId.includes('?') || sessionId.includes('#')) {
    throw new Error('sessionId must not contain /, ?, or #')
  }
  return sessionId
}

/** Durable stream id for Yjs document updates (ProseMirror binding). */
export function docCollaborationDocId(docKey: string): string {
  return `${YJS_DOC_ROOT}/${sanitizeDocKey(docKey)}/${DOC_LAYOUT_VERSION}/collaboration`
}

/**
 * Awareness query value for presence on the collaboration stream.
 * The human-readable “presence stream” is this sub-resource of the collaboration durable stream.
 */
export function docPresenceAwarenessName(): string {
  return 'default'
}

/**
 * Durable stream path for the per-document chat session (sidebar).
 * Example: `docs/demo-doc/chat/default`
 */
export function chatSessionStreamPath(docKey: string, sessionId: string = 'default'): string {
  return `${CHAT_ROOT}/${sanitizeDocKey(docKey)}/chat/${sanitizeSessionId(sessionId)}`
}

/** Full HTTP URL for a raw durable stream (`/v1/stream/...`) on the Durable Streams server. */
export function durableStreamResourceUrl(origin: string, streamPath: string): string {
  return `${origin.replace(/\/$/, '')}/v1/stream/${streamPath}`
}

/** Server-side origin for Durable Streams (Node); prefers `DURABLE_STREAMS_BASE_URL` then `VITE_DURABLE_STREAMS_BASE_URL`. */
export function getDurableStreamsOriginServer(): string {
  if (typeof process !== 'undefined' && process.env.DURABLE_STREAMS_BASE_URL) {
    return process.env.DURABLE_STREAMS_BASE_URL.replace(/\/$/, '')
  }
  const vite = viteEnv.VITE_DURABLE_STREAMS_BASE_URL
  if (typeof vite === 'string' && vite.length > 0) {
    return vite.replace(/\/$/, '')
  }
  return 'http://127.0.0.1:4438'
}

/** Origin only, e.g. `http://127.0.0.1:4438` (no trailing slash). */
export function getDurableStreamsOrigin(): string {
  const u = viteEnv.VITE_DURABLE_STREAMS_BASE_URL
  if (typeof u === 'string' && u.length > 0) {
    return u.replace(/\/$/, '')
  }
  return 'http://127.0.0.1:4438'
}

/** Full Yjs HTTP base URL including service segment. */
export function durableStreamsYjsBaseUrl(origin: string): string {
  return `${origin.replace(/\/$/, '')}/v1/yjs/${YJS_SERVICE_NAME}`
}
