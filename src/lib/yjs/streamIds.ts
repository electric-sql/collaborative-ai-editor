/**
 * Deterministic durable stream paths for each logical document.
 *
 * Yjs collaboration uses `docCollaborationDocId` as the provider `docId`.
 * Presence/cursors use the Yjs awareness channel on the same collaboration stream
 * (`?awareness=<name>`); `@durable-streams/y-durable-streams` currently uses `default`.
 * Chat sessions (TanStack AI transport) use `chatSessionStreamPath(docKey, sessionId)`.
 */

const YJS_DOC_ROOT = 'rooms'
const CHAT_ROOT = 'chats'
const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}
const DOC_LAYOUT_VERSION = 'v3'

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed) return trimmed
  }
  return undefined
}

function authHeadersFromSecret(secret: string | undefined): Record<string, string> | undefined {
  const trimmed = secret?.trim()
  if (!trimmed) return undefined
  return { Authorization: `Bearer ${trimmed}` }
}

export function getAppOriginServer(): string {
  return (
    firstNonEmpty(
      typeof process !== 'undefined' ? process.env.APP_BASE_URL : undefined,
      typeof process !== 'undefined' ? process.env.PUBLIC_APP_BASE_URL : undefined,
    ) ?? 'http://localhost:3000'
  ).replace(/\/$/, '')
}

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

/** Server-side origin for the Yjs Durable Streams service. */
export function getYjsDurableStreamsOriginServer(): string {
  return (
    firstNonEmpty(
      typeof process !== 'undefined' ? process.env.DURABLE_STREAMS_YJS_BASE_URL : undefined,
      typeof process !== 'undefined' ? process.env.DURABLE_STREAMS_BASE_URL : undefined,
    ) ?? 'http://127.0.0.1:4438'
  ).replace(/\/$/, '')
}

/** Full Yjs HTTP base URL including service segment. */
export function durableStreamsYjsBaseUrl(origin: string): string {
  return `${origin.replace(/\/$/, '')}/v1/yjs/${YJS_SERVICE_NAME}`
}

export function appYjsProxyBaseUrl(): string {
  if (typeof window !== 'undefined' && typeof window.location?.origin === 'string') {
    return `${window.location.origin}/api/yjs`
  }
  return `/api/yjs`
}

/** Server-side origin for the TanStack AI Durable Streams service. */
export function getTanStackAiDurableStreamsOriginServer(): string {
  return (
    firstNonEmpty(
      typeof process !== 'undefined' ? process.env.DURABLE_STREAMS_CHAT_BASE_URL : undefined,
      typeof process !== 'undefined' ? process.env.DURABLE_STREAMS_BASE_URL : undefined,
    ) ?? 'http://127.0.0.1:4437'
  ).replace(/\/$/, '')
}

export function getYjsDurableStreamsHeadersServer(): Record<string, string> | undefined {
  return authHeadersFromSecret(
    firstNonEmpty(
      typeof process !== 'undefined' ? process.env.DURABLE_STREAMS_YJS_SECRET : undefined,
    ),
  )
}

export function getYjsDurableStreamsSecretServer(): string | undefined {
  return firstNonEmpty(
    typeof process !== 'undefined' ? process.env.DURABLE_STREAMS_YJS_SECRET : undefined,
  )
}

export function getTanStackAiDurableStreamsHeadersServer(): Record<string, string> | undefined {
  return authHeadersFromSecret(
    firstNonEmpty(
      typeof process !== 'undefined' ? process.env.DURABLE_STREAMS_CHAT_SECRET : undefined,
    ),
  )
}
