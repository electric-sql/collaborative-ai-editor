import type { Node as PMNode } from 'prosemirror-model'
import { EditorState, TextSelection } from 'prosemirror-state'
import * as Y from 'yjs'
import { initProseMirrorDoc, updateYFragment, absolutePositionToRelativePosition } from 'y-prosemirror'
import type { ProsemirrorMapping } from './relativeAnchors'
import { decodeAnchor, decodeAnchorBase64 } from './relativeAnchors'
import { buildAgentSystemPrompt, buildAgentUserPromptTemplate } from './prompts'
import { takeStablePrefix } from './stability'
import { streamOpenAiText } from './openaiStream'
import {
  createAgentTransactionOrigin,
  createServerAgentSession,
  type ServerAgentSession,
} from './serverAgentSession'
import { schema } from '../editor/schema'
import type { AgentRunMode, AgentTransactionOrigin } from './types'
import type { YjsProvider } from '@durable-streams/y-durable-streams'

export type { AgentRunMode }

export interface RunAgentInput {
  docKey: string
  sessionId: string
  mode: AgentRunMode
  prompt: string
  insertAnchorB64?: string
  rewriteStartB64?: string
  rewriteEndB64?: string
  cursorAnchor?: number
  cursorHead?: number
  signal?: AbortSignal
}

export interface RunAgentResult {
  assistantText: string
  committedChars: number
  cancelled?: boolean
}

function waitForProviderSync(provider: YjsProvider, timeoutMs: number): Promise<void> {
  if (provider.synced) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      provider.off('synced', onSync)
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for Yjs provider sync`))
    }, timeoutMs)
    const onSync = (synced: boolean) => {
      if (synced) {
        clearTimeout(t)
        provider.off('synced', onSync)
        resolve()
      }
    }
    provider.on('synced', onSync)
  })
}

function clampTextPos(doc: PMNode, pos: number): number {
  const size = doc.content.size
  const clamped = Math.max(0, Math.min(pos, size))
  try {
    doc.resolve(clamped)
    return clamped
  } catch {
    return TextSelection.atEnd(doc).from
  }
}

function ensureMinimumBlock(session: ServerAgentSession, origin: AgentTransactionOrigin): void {
  if (session.fragment.length > 0) {
    return
  }
  const emptyDoc = schema.node('doc', null, [schema.node('paragraph')])
  const meta = { mapping: new Map(), isOMark: new Map() }
  session.ydoc.transact((tr) => {
    tr.meta.set('addToHistory', false)
    updateYFragment(session.ydoc, session.fragment, emptyDoc, meta as never)
  }, origin)
}

function applyPmRootToY(
  session: ServerAgentSession,
  nextDoc: import('prosemirror-model').Node,
  meta: ReturnType<typeof initProseMirrorDoc>['meta'],
  origin: AgentTransactionOrigin,
): void {
  session.ydoc.transact((ytr) => {
    ytr.meta.set('addToHistory', false)
    updateYFragment(session.ydoc, session.fragment, nextDoc, meta as never)
  }, origin)
}

function insertAt(
  session: ServerAgentSession,
  origin: AgentTransactionOrigin,
  text: string,
  pos: number,
): number {
  const { doc, meta } = initProseMirrorDoc(session.fragment, schema)
  const insertPos = clampTextPos(doc, pos)
  const state = EditorState.create({ doc, schema })
  const tr = state.tr
  tr.setMeta('addToHistory', false)
  tr.insertText(text, insertPos)
  if (!tr.docChanged) {
    return insertPos
  }
  applyPmRootToY(session, tr.doc, meta, origin)
  return insertPos + text.length
}

function rewriteStableChunk(
  session: ServerAgentSession,
  origin: AgentTransactionOrigin,
  from: number,
  to: number,
  newChunk: string,
): number {
  const { doc, meta } = initProseMirrorDoc(session.fragment, schema)
  const span = Math.max(0, to - from)
  const delLen = Math.min(newChunk.length, span)
  const state = EditorState.create({ doc, schema })
  const tr = state.tr
  tr.setMeta('addToHistory', false)
  tr.insertText(newChunk, from)
  const afterInsert = from + newChunk.length
  if (delLen > 0 && afterInsert <= tr.doc.content.size) {
    const delEnd = Math.min(afterInsert + delLen, tr.doc.content.size)
    tr.delete(afterInsert, delEnd)
  }
  if (!tr.docChanged) {
    return from
  }
  applyPmRootToY(session, tr.doc, meta, origin)
  return afterInsert
}

function encodeAnchorAt(
  session: ServerAgentSession,
  absPos: number,
  mapping: ProsemirrorMapping,
): Uint8Array {
  const rel = absolutePositionToRelativePosition(absPos, session.fragment, mapping as never)
  return Y.encodeRelativePosition(rel)
}

function resolveInsertPos(
  session: ServerAgentSession,
  mapping: ProsemirrorMapping,
  insertAnchorBytes: Uint8Array | undefined,
  fallbackAbs: number | undefined,
): number | null {
  if (insertAnchorBytes) {
    const p = decodeAnchor(session.ydoc, session.fragment, mapping, insertAnchorBytes)
    if (p !== null) return p
  }
  if (fallbackAbs !== undefined) {
    const { doc } = initProseMirrorDoc(session.fragment, schema)
    return clampTextPos(doc, fallbackAbs)
  }
  return null
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Agent run aborted', 'AbortError')
  }
}

function readDocContext(session: ServerAgentSession, maxChars: number = 6000): string {
  const { doc } = initProseMirrorDoc(session.fragment, schema)
  const text = doc.textBetween(0, doc.content.size, '\n\n', '\n').trim()
  if (text.length <= maxChars) return text
  return text.slice(-maxChars)
}

function openAiApiKey(): string | null {
  const key = process.env.OPENAI_API_KEY?.trim()
  return key && key.length > 0 ? key : null
}

export async function runServerAgentSession(input: RunAgentInput): Promise<RunAgentResult> {
  const session = createServerAgentSession(input.docKey, input.sessionId)
  const origin = createAgentTransactionOrigin(input.sessionId)
  let assistantText = ''
  let committedChars = 0

  let insertAnchorBytes: Uint8Array | undefined = input.insertAnchorB64
    ? decodeAnchorBase64(input.insertAnchorB64)
    : undefined

  let rewriteStartBytes: Uint8Array | undefined = input.rewriteStartB64
    ? decodeAnchorBase64(input.rewriteStartB64)
    : undefined
  let rewriteEndBytes: Uint8Array | undefined = input.rewriteEndB64
    ? decodeAnchorBase64(input.rewriteEndB64)
    : undefined

  try {
    await waitForProviderSync(session.provider, 20_000)
    session.setStatus('thinking')
    ensureMinimumBlock(session, origin)

    if (input.mode === 'rewrite') {
      if (!rewriteStartBytes || !rewriteEndBytes) {
        const { doc, meta } = initProseMirrorDoc(session.fragment, schema)
        let from = input.cursorAnchor ?? 1
        let to = input.cursorHead ?? from
        if (from > to) {
          const s = from
          from = to
          to = s
        }
        from = clampTextPos(doc, from)
        to = clampTextPos(doc, to)
        rewriteStartBytes = encodeAnchorAt(session, from, meta.mapping as ProsemirrorMapping)
        rewriteEndBytes = encodeAnchorAt(session, to, meta.mapping as ProsemirrorMapping)
      }
    } else {
      if (!insertAnchorBytes) {
        const { doc, meta } = initProseMirrorDoc(session.fragment, schema)
        const end =
          input.cursorAnchor !== undefined
            ? clampTextPos(doc, input.cursorAnchor)
            : TextSelection.atEnd(doc).from
        insertAnchorBytes = encodeAnchorAt(session, end, meta.mapping as ProsemirrorMapping)
      }
    }

    let buffer = ''
    const systemPrompt = buildAgentSystemPrompt()
    const userPrompt = [
      buildAgentUserPromptTemplate(input.mode, input.prompt),
      `Document key: ${input.docKey}`,
      `Current document context:\n${readDocContext(session) || '(empty document)'}`,
    ].join('\n\n')
    const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini'
    const key = openAiApiKey()

    if (key === null) {
      throw new Error('OPENAI_API_KEY is missing on the server runtime')
    }
    const sourceStream = streamOpenAiText({
      apiKey: key,
      model,
      systemPrompt,
      userPrompt,
      signal: input.signal,
    })

    for await (const chunk of sourceStream) {
      throwIfAborted(input.signal)
      assistantText += chunk
      buffer += chunk
      const { stable, rest } = takeStablePrefix(buffer)
      buffer = rest
      session.setTail(buffer.length > 0 ? buffer : null)

      if (stable.length === 0) {
        continue
      }

      session.setStatus('composing')

      if (input.mode === 'rewrite') {
        const { meta: mapMeta } = initProseMirrorDoc(session.fragment, schema)
        const mapping = mapMeta.mapping as ProsemirrorMapping
        const from = rewriteStartBytes
          ? decodeAnchor(session.ydoc, session.fragment, mapping, rewriteStartBytes)
          : null
        const to = rewriteEndBytes
          ? decodeAnchor(session.ydoc, session.fragment, mapping, rewriteEndBytes)
          : null
        if (from === null || to === null) {
          continue
        }
        const endPos = rewriteStableChunk(session, origin, from, to, stable)
        committedChars += stable.length
        const { meta: mapMeta2 } = initProseMirrorDoc(session.fragment, schema)
        session.setCursorFromAbsolute(endPos, mapMeta2.mapping as ProsemirrorMapping)
      } else {
        const { meta: mapMeta } = initProseMirrorDoc(session.fragment, schema)
        const mapping = mapMeta.mapping as ProsemirrorMapping
        const pos = resolveInsertPos(
          session,
          mapping,
          insertAnchorBytes,
          input.cursorAnchor,
        )
        if (pos === null) {
          continue
        }
        const endPos = insertAt(session, origin, stable, pos)
        committedChars += stable.length
        const { meta: mapMeta2 } = initProseMirrorDoc(session.fragment, schema)
        insertAnchorBytes = encodeAnchorAt(session, endPos, mapMeta2.mapping as ProsemirrorMapping)
        session.setCursorFromAbsolute(endPos, mapMeta2.mapping as ProsemirrorMapping)
      }
    }

    throwIfAborted(input.signal)

    if (buffer.length > 0) {
      session.setStatus('composing')
      if (input.mode === 'rewrite') {
        const { meta: mapMeta } = initProseMirrorDoc(session.fragment, schema)
        const mapping = mapMeta.mapping as ProsemirrorMapping
        const from = rewriteStartBytes
          ? decodeAnchor(session.ydoc, session.fragment, mapping, rewriteStartBytes)
          : null
        const to = rewriteEndBytes
          ? decodeAnchor(session.ydoc, session.fragment, mapping, rewriteEndBytes)
          : null
        if (from !== null && to !== null) {
          const endPos = rewriteStableChunk(session, origin, from, to, buffer)
          committedChars += buffer.length
          const { meta: mapMeta2 } = initProseMirrorDoc(session.fragment, schema)
          session.setCursorFromAbsolute(endPos, mapMeta2.mapping as ProsemirrorMapping)
        }
      } else {
        const { meta: mapMeta } = initProseMirrorDoc(session.fragment, schema)
        const mapping = mapMeta.mapping as ProsemirrorMapping
        const pos = resolveInsertPos(
          session,
          mapping,
          insertAnchorBytes,
          input.cursorAnchor,
        )
        if (pos !== null) {
          const endPos = insertAt(session, origin, buffer, pos)
          committedChars += buffer.length
          const { meta: mapMeta2 } = initProseMirrorDoc(session.fragment, schema)
          session.setCursorFromAbsolute(endPos, mapMeta2.mapping as ProsemirrorMapping)
        }
      }
      buffer = ''
    }

    session.setTail(null)
    session.setStatus('idle')
    if (!assistantText) {
      throw new Error('OpenAI returned no text chunks')
    }
    return { assistantText, committedChars }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      session.setTail(null)
      session.setStatus('idle')
      return { assistantText, committedChars, cancelled: true }
    }
    throw e
  } finally {
    session.clearCursor()
    session.setTail(null)
    session.destroy()
  }
}
