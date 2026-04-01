import { Fragment as PMFragment, type Node as PMNode } from 'prosemirror-model'
import { EditorState, TextSelection } from 'prosemirror-state'
import { setBlockType } from 'prosemirror-commands'
import { wrapInList, liftListItem } from 'prosemirror-schema-list'
import type { YjsProvider } from '@durable-streams/y-durable-streams'
import * as Y from 'yjs'
import {
  absolutePositionToRelativePosition,
  initProseMirrorDoc,
  updateYFragment,
} from 'y-prosemirror'
import { schema } from '../editor/schema'
import { decodeAnchor, decodeAnchorBase64 } from './relativeAnchors'
import type { ProsemirrorMapping } from './relativeAnchors'
import { createAgentTransactionOrigin, createServerAgentSession, type ServerAgentSession } from './serverAgentSession'
import {
  createStreamingMarkdownState,
  diffMarkdownDocsForAppend,
  endStreamingMarkdown,
  isEffectivelyEmptyMarkdownDoc,
  streamStateToProsemirrorDoc,
  writeStreamingMarkdown,
  type StreamingMarkdownState,
} from './markdownToProsemirror'
import { takeStablePrefix } from './stability'
import type { AgentRunMode, AgentTransactionOrigin } from './types'

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

function replaceRange(
  session: ServerAgentSession,
  origin: AgentTransactionOrigin,
  from: number,
  to: number,
  text: string,
): number {
  const { doc, meta } = initProseMirrorDoc(session.fragment, schema)
  const safeFrom = clampTextPos(doc, Math.min(from, to))
  const safeTo = clampTextPos(doc, Math.max(from, to))
  const state = EditorState.create({ doc, schema })
  const tr = state.tr
  tr.setMeta('addToHistory', false)
  tr.insertText(text, safeFrom, safeTo)
  if (!tr.docChanged) {
    return safeFrom
  }
  applyPmRootToY(session, tr.doc, meta, origin)
  return safeFrom + text.length
}

function deleteRange(
  session: ServerAgentSession,
  origin: AgentTransactionOrigin,
  from: number,
  to: number,
): number {
  const { doc, meta } = initProseMirrorDoc(session.fragment, schema)
  const safeFrom = clampTextPos(doc, Math.min(from, to))
  const safeTo = clampTextPos(doc, Math.max(from, to))
  const state = EditorState.create({ doc, schema })
  const tr = state.tr
  tr.setMeta('addToHistory', false)
  tr.delete(safeFrom, safeTo)
  if (!tr.docChanged) {
    return safeFrom
  }
  applyPmRootToY(session, tr.doc, meta, origin)
  return safeFrom
}

function replaceRangeWithFragment(
  session: ServerAgentSession,
  origin: AgentTransactionOrigin,
  from: number,
  to: number,
  fragment: PMFragment,
): { endPos: number; tailTextPos: number } {
  const { doc, meta } = initProseMirrorDoc(session.fragment, schema)
  const safeFrom = clampTextPos(doc, Math.min(from, to))
  const safeTo = clampTextPos(doc, Math.max(from, to))
  const state = EditorState.create({ doc, schema })
  const tr = state.tr
  tr.setMeta('addToHistory', false)
  tr.replaceWith(safeFrom, safeTo, fragment)
  if (!tr.docChanged) {
    return { endPos: safeFrom, tailTextPos: safeFrom }
  }
  applyPmRootToY(session, tr.doc, meta, origin)
  const endPos = safeFrom + fragment.size
  let tailTextPos = endPos
  tr.doc.nodesBetween(safeFrom, endPos, (node, pos) => {
    if (node.isTextblock) {
      tailTextPos = pos + node.nodeSize - 1
    }
  })
  return { endPos, tailTextPos }
}

function encodeAnchorAt(
  session: ServerAgentSession,
  absPos: number,
  mapping: ProsemirrorMapping,
): Uint8Array {
  const rel = absolutePositionToRelativePosition(absPos, session.fragment, mapping as never)
  return Y.encodeRelativePosition(rel)
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function resolveAnchor(
  session: ServerAgentSession,
  mapping: ProsemirrorMapping,
  anchor: Uint8Array | undefined,
): number | null {
  if (!anchor) return null
  return decodeAnchor(session.ydoc, session.fragment, mapping, anchor)
}

function normalizeRange(from: number, to: number): { from: number; to: number } {
  return from <= to ? { from, to } : { from: to, to: from }
}

function preview(text: string, index: number, queryLength: number): { before: string; after: string } {
  return {
    before: text.slice(Math.max(0, index - 30), index),
    after: text.slice(index + queryLength, Math.min(text.length, index + queryLength + 30)),
  }
}

function isNodeActive(state: EditorState, nodeType: import('prosemirror-model').NodeType): boolean {
  const { $from } = state.selection
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type === nodeType) return true
  }
  return false
}

function resolveBlockInsertPos(doc: PMNode, pos: number): number {
  const clamped = Math.max(0, Math.min(pos, doc.content.size))
  const $pos = doc.resolve(clamped)
  if ($pos.depth === 0) {
    return clamped
  }
  if ($pos.parentOffset === 0) {
    return $pos.before($pos.depth)
  }
  if ($pos.parentOffset === $pos.parent.content.size) {
    return $pos.after($pos.depth)
  }
  return $pos.after($pos.depth)
}

function resolveNodePathPosition(doc: PMNode, path: number[]): { node: PMNode; pos: number } | null {
  let node = doc
  let pos = 0

  for (let depth = 0; depth < path.length; depth++) {
    const index = path[depth]!
    if (index < 0 || index >= node.childCount) return null
    let offset = 0
    for (let i = 0; i < index; i++) offset += node.child(i).nodeSize
    pos = node.type === schema.nodes.doc ? pos + offset : pos + 1 + offset
    node = node.child(index)
  }

  return { node, pos }
}

function insertionPosAtEndOfNode(doc: PMNode, path: number[]): number | null {
  if (path.length === 0) {
    return doc.content.size
  }
  const resolved = resolveNodePathPosition(doc, path)
  if (!resolved) return null
  return resolved.pos + resolved.node.content.size + 1
}

export interface SearchMatchResult {
  matchId: string
  text: string
  before: string
  after: string
  startAnchorB64: string
  endAnchorB64: string
}

type SearchMatchHandle = SearchMatchResult

export type FormatKind = 'mark' | 'block'
export type FormatName =
  | 'bold'
  | 'italic'
  | 'code'
  | 'paragraph'
  | 'heading'
  | 'bullet_list'
  | 'ordered_list'
export type FormatAction = 'add' | 'remove' | 'toggle' | 'set'
export type ContentFormat = 'plain_text' | 'markdown'
export type CompletedDocumentMutation =
  | { kind: 'insert_text'; insertedChars: number }
  | { kind: 'delete_selection' }
  | { kind: 'set_format'; formatKind: FormatKind; format: FormatName; action: FormatAction | 'set' }
  | {
      kind: 'streaming_edit'
      mode: AgentRunMode
      contentFormat: ContentFormat
      committedChars: number
      cancelled?: boolean
    }

interface ActiveStreamingEdit {
  id: string
  mode: AgentRunMode
  contentFormat: ContentFormat
  insertAnchorBytes?: Uint8Array
  rewriteStartBytes?: Uint8Array
  rewriteEndBytes?: Uint8Array
  buffer: string
  committedChars: number
  rewrittenText: string
  markdownSource: string
  renderedMarkdownDoc: PMNode | null
  markdownState: StreamingMarkdownState | null
  deletedSelectionText?: string
}

export class DocumentToolRuntime {
  private readonly origin: AgentTransactionOrigin
  private cursorAnchorBytes: Uint8Array | undefined
  private selectionStartBytes: Uint8Array | undefined
  private selectionEndBytes: Uint8Array | undefined
  private readonly matches = new Map<string, SearchMatchHandle>()
  private activeEdit: ActiveStreamingEdit | null = null
  private readonly completedMutations: CompletedDocumentMutation[] = []

  private constructor(
    private readonly session: ServerAgentSession,
    private readonly signal: AbortSignal | undefined,
  ) {
    this.origin = createAgentTransactionOrigin(session.sessionId)
  }

  static async create(input: {
    docKey: string
    sessionId: string
    signal?: AbortSignal
  }): Promise<DocumentToolRuntime> {
    const session = createServerAgentSession(input.docKey, input.sessionId)
    const runtime = new DocumentToolRuntime(session, input.signal)
    await waitForProviderSync(session.provider, 20_000)
    ensureMinimumBlock(session, runtime.origin)
    runtime.ensureCursorAtEnd()
    session.setStatus('idle')
    return runtime
  }

  static createForSession(input: {
    session: ServerAgentSession
    signal?: AbortSignal
  }): DocumentToolRuntime {
    const runtime = new DocumentToolRuntime(input.session, input.signal)
    ensureMinimumBlock(input.session, runtime.origin)
    runtime.ensureCursorAtEnd()
    input.session.setStatus('idle')
    return runtime
  }

  private throwIfAborted(): void {
    if (this.signal?.aborted) {
      throw new DOMException('Agent run aborted', 'AbortError')
    }
  }

  private getMapping(): ReturnType<typeof initProseMirrorDoc> {
    return initProseMirrorDoc(this.session.fragment, schema)
  }

  getCompletedMutations(): ReadonlyArray<CompletedDocumentMutation> {
    return this.completedMutations
  }

  getCompletedMutationCount(): number {
    return this.completedMutations.length
  }

  private ensureCursorAtEnd(): void {
    if (this.cursorAnchorBytes) return
    const { doc, meta } = this.getMapping()
    const end = TextSelection.atEnd(doc).from
    this.cursorAnchorBytes = encodeAnchorAt(this.session, end, meta.mapping as ProsemirrorMapping)
    this.session.setCursorFromAbsolute(end, meta.mapping as ProsemirrorMapping)
  }

  private updateCursor(absPos: number): void {
    const { meta } = this.getMapping()
    const mapping = meta.mapping as ProsemirrorMapping
    this.cursorAnchorBytes = encodeAnchorAt(this.session, absPos, mapping)
    this.session.setCursorFromAbsolute(absPos, mapping)
  }

  private resolveSelection(): { from: number; to: number } | null {
    if (!this.selectionStartBytes || !this.selectionEndBytes) return null
    const { meta } = this.getMapping()
    const mapping = meta.mapping as ProsemirrorMapping
    const from = resolveAnchor(this.session, mapping, this.selectionStartBytes)
    const to = resolveAnchor(this.session, mapping, this.selectionEndBytes)
    if (from === null || to === null) return null
    return normalizeRange(from, to)
  }

  private clearSelectionInternal(): void {
    this.selectionStartBytes = undefined
    this.selectionEndBytes = undefined
  }

  getDocumentSnapshot(
    maxChars: number = 6000,
    startChar: number = 0,
  ): { text: string; charCount: number; startChar: number; endChar: number } {
    const { doc } = this.getMapping()
    const text = doc.textBetween(0, doc.content.size, '\n\n', '\n')
    const safeStart = Math.max(0, Math.min(startChar, text.length))
    const safeEnd = Math.max(safeStart, Math.min(safeStart + maxChars, text.length))
    return {
      text: text.slice(safeStart, safeEnd),
      charCount: text.length,
      startChar: safeStart,
      endChar: safeEnd,
    }
  }

  getSelectionSnapshot(): { text: string; from: number; to: number } | null {
    const selection = this.resolveSelection()
    if (!selection) return null
    const { doc } = this.getMapping()
    return {
      text: doc.textBetween(selection.from, selection.to, '\n\n', '\n'),
      from: selection.from,
      to: selection.to,
    }
  }

  searchText(query: string, maxResults: number = 8): SearchMatchResult[] {
    const trimmed = query.trim()
    if (!trimmed) return []
    const { doc, meta } = this.getMapping()
    const mapping = meta.mapping as ProsemirrorMapping
    const matches: SearchMatchResult[] = []

    doc.descendants((node, pos) => {
      if (!node.isTextblock || matches.length >= maxResults) {
        return matches.length < maxResults
      }
      const text = node.textContent
      if (!text) return true
      let fromIndex = 0
      while (fromIndex < text.length && matches.length < maxResults) {
        const found = text.indexOf(trimmed, fromIndex)
        if (found < 0) break
        const startAbs = clampTextPos(doc, pos + 1 + found)
        const endAbs = clampTextPos(doc, startAbs + trimmed.length)
        const handle: SearchMatchHandle = {
          matchId: crypto.randomUUID(),
          text: trimmed,
          ...preview(text, found, trimmed.length),
          startAnchorB64: bytesToBase64(encodeAnchorAt(this.session, startAbs, mapping)),
          endAnchorB64: bytesToBase64(encodeAnchorAt(this.session, endAbs, mapping)),
        }
        this.matches.set(handle.matchId, handle)
        matches.push(handle)
        fromIndex = found + Math.max(1, trimmed.length)
      }
      return matches.length < maxResults
    })

    return matches
  }

  placeCursor(matchId: string, edge: 'start' | 'end' = 'start'): { ok: true; cursorAnchorB64: string } {
    const handle = this.matches.get(matchId)
    if (!handle) {
      throw new Error(`Unknown matchId: ${matchId}`)
    }
    const next = decodeAnchorBase64(edge === 'start' ? handle.startAnchorB64 : handle.endAnchorB64)
    const { meta } = this.getMapping()
    const mapping = meta.mapping as ProsemirrorMapping
    const absPos = resolveAnchor(this.session, mapping, next)
    if (absPos === null) {
      throw new Error('Could not resolve cursor target')
    }
    this.cursorAnchorBytes = next
    this.clearSelectionInternal()
    this.session.setCursorFromAbsolute(absPos, mapping)
    return { ok: true, cursorAnchorB64: bytesToBase64(next) }
  }

  placeCursorAtDocumentBoundary(
    boundary: 'start' | 'end',
  ): { ok: true; cursorAnchorB64: string; boundary: 'start' | 'end' } {
    const { doc, meta } = this.getMapping()
    const mapping = meta.mapping as ProsemirrorMapping
    const absPos =
      boundary === 'start' ? TextSelection.atStart(doc).from : TextSelection.atEnd(doc).from
    const next = encodeAnchorAt(this.session, absPos, mapping)
    this.cursorAnchorBytes = next
    this.clearSelectionInternal()
    this.session.setCursorFromAbsolute(absPos, mapping)
    return {
      ok: true,
      cursorAnchorB64: bytesToBase64(next),
      boundary,
    }
  }

  selectText(matchId: string): { ok: true; selectedText: string } {
    const handle = this.matches.get(matchId)
    if (!handle) {
      throw new Error(`Unknown matchId: ${matchId}`)
    }
    this.selectionStartBytes = decodeAnchorBase64(handle.startAnchorB64)
    this.selectionEndBytes = decodeAnchorBase64(handle.endAnchorB64)
    this.cursorAnchorBytes = this.selectionEndBytes
    const { meta } = this.getMapping()
    const mapping = meta.mapping as ProsemirrorMapping
    const absPos = resolveAnchor(this.session, mapping, this.selectionEndBytes)
    if (absPos !== null) {
      this.session.setCursorFromAbsolute(absPos, mapping)
    }
    return { ok: true, selectedText: handle.text }
  }

  selectCurrentBlock(): { ok: true; selectedText: string } {
    this.ensureCursorAtEnd()
    const { doc, meta } = this.getMapping()
    const mapping = meta.mapping as ProsemirrorMapping
    const cursorPos = resolveAnchor(this.session, mapping, this.cursorAnchorBytes)
    if (cursorPos === null) {
      throw new Error('Could not resolve cursor position')
    }
    const $pos = doc.resolve(clampTextPos(doc, cursorPos))
    if (!$pos.parent.isTextblock) {
      throw new Error('Current cursor is not inside a text block')
    }
    const from = $pos.start()
    const to = $pos.end()
    this.selectionStartBytes = encodeAnchorAt(this.session, from, mapping)
    this.selectionEndBytes = encodeAnchorAt(this.session, to, mapping)
    this.cursorAnchorBytes = this.selectionEndBytes
    this.session.setCursorFromAbsolute(to, mapping)
    return {
      ok: true,
      selectedText: doc.textBetween(from, to, '\n\n', '\n'),
    }
  }

  selectBetweenMatches(
    startMatchId: string,
    endMatchId: string,
    startEdge: 'start' | 'end' = 'start',
    endEdge: 'start' | 'end' = 'end',
  ): { ok: true } {
    const startHandle = this.matches.get(startMatchId)
    const endHandle = this.matches.get(endMatchId)
    if (!startHandle || !endHandle) {
      throw new Error('Unknown matchId in select_between_matches')
    }
    const startBytes = decodeAnchorBase64(
      startEdge === 'start' ? startHandle.startAnchorB64 : startHandle.endAnchorB64,
    )
    const endBytes = decodeAnchorBase64(
      endEdge === 'start' ? endHandle.startAnchorB64 : endHandle.endAnchorB64,
    )
    const { meta } = this.getMapping()
    const mapping = meta.mapping as ProsemirrorMapping
    const startAbs = resolveAnchor(this.session, mapping, startBytes)
    const endAbs = resolveAnchor(this.session, mapping, endBytes)
    if (startAbs === null || endAbs === null) {
      throw new Error('Could not resolve selection range')
    }
    const range = normalizeRange(startAbs, endAbs)
    this.selectionStartBytes = encodeAnchorAt(this.session, range.from, mapping)
    this.selectionEndBytes = encodeAnchorAt(this.session, range.to, mapping)
    this.cursorAnchorBytes = this.selectionEndBytes
    this.session.setCursorFromAbsolute(range.to, mapping)
    return { ok: true }
  }

  clearSelection(): { ok: true } {
    this.clearSelectionInternal()
    this.ensureCursorAtEnd()
    return { ok: true }
  }

  setFormat(input: {
    kind: FormatKind
    format: FormatName
    action?: FormatAction
    level?: number
  }): { ok: true; kind: FormatKind; format: FormatName; action: FormatAction } {
    this.throwIfAborted()
    const selection = this.resolveSelection()
    if (!selection) {
      throw new Error('Formatting requires an active selection')
    }

    const action = input.action ?? (input.kind === 'mark' ? 'toggle' : 'set')
    const { doc, meta } = this.getMapping()
    const state = EditorState.create({
      doc,
      schema,
      selection: TextSelection.create(doc, selection.from, selection.to),
    })
    let appliedTr: EditorState['tr'] | null = null
    const dispatch = (tr: EditorState['tr']) => {
      tr.setMeta('addToHistory', false)
      appliedTr = tr
    }

    if (input.kind === 'mark') {
      const markType =
        input.format === 'bold'
          ? schema.marks.strong
          : input.format === 'italic'
            ? schema.marks.em
            : input.format === 'code'
              ? schema.marks.code
              : null
      if (!markType) {
        throw new Error(`Unsupported mark format: ${input.format}`)
      }
      const hasMark = state.doc.rangeHasMark(state.selection.from, state.selection.to, markType)
      const shouldAdd =
        action === 'add' || action === 'set' || (action === 'toggle' && !hasMark)
      const tr = state.tr
      tr.setMeta('addToHistory', false)
      if (shouldAdd) {
        tr.addMark(state.selection.from, state.selection.to, markType.create())
      } else {
        tr.removeMark(state.selection.from, state.selection.to, markType)
      }
      appliedTr = tr
    } else {
      switch (input.format) {
        case 'paragraph':
          setBlockType(schema.nodes.paragraph)(state, dispatch)
          break
        case 'heading':
          setBlockType(schema.nodes.heading, { level: input.level ?? 2 })(state, dispatch)
          break
        case 'bullet_list': {
          const listItem = schema.nodes.list_item
          const listNode = schema.nodes.bullet_list
          if (!listItem || !listNode) {
            throw new Error('Bullet list formatting is not available in this schema')
          }
          const active = isNodeActive(state, listNode)
          if (action === 'remove' || (action === 'toggle' && active)) {
            liftListItem(listItem)(state, dispatch)
          } else {
            wrapInList(listNode)(state, dispatch)
          }
          break
        }
        case 'ordered_list': {
          const listItem = schema.nodes.list_item
          const listNode = schema.nodes.ordered_list
          if (!listItem || !listNode) {
            throw new Error('Ordered list formatting is not available in this schema')
          }
          const active = isNodeActive(state, listNode)
          if (action === 'remove' || (action === 'toggle' && active)) {
            liftListItem(listItem)(state, dispatch)
          } else {
            wrapInList(listNode)(state, dispatch)
          }
          break
        }
        default:
          throw new Error(`Unsupported block format: ${input.format}`)
      }
    }

    if (!appliedTr || !appliedTr.docChanged) {
      return { ok: true, kind: input.kind, format: input.format, action }
    }

    applyPmRootToY(this.session, appliedTr.doc, meta, this.origin)
    this.completedMutations.push({
      kind: 'set_format',
      formatKind: input.kind,
      format: input.format,
      action,
    })
    const nextFrom = appliedTr.selection.from
    const nextTo = appliedTr.selection.to
    const { meta: nextMeta } = this.getMapping()
    const mapping = nextMeta.mapping as ProsemirrorMapping
    this.selectionStartBytes = encodeAnchorAt(this.session, nextFrom, mapping)
    this.selectionEndBytes = encodeAnchorAt(this.session, nextTo, mapping)
    this.cursorAnchorBytes = this.selectionEndBytes
    this.session.setCursorFromAbsolute(nextTo, mapping)
    return { ok: true, kind: input.kind, format: input.format, action }
  }

  insertText(text: string): { ok: true; insertedChars: number } {
    this.throwIfAborted()
    const selection = this.resolveSelection()
    let endPos: number
    if (selection) {
      endPos = replaceRange(this.session, this.origin, selection.from, selection.to, text)
      this.clearSelectionInternal()
    } else {
      this.ensureCursorAtEnd()
      const { meta } = this.getMapping()
      const mapping = meta.mapping as ProsemirrorMapping
      const pos = resolveAnchor(this.session, mapping, this.cursorAnchorBytes)
      if (pos === null) {
        throw new Error('Could not resolve cursor position')
      }
      endPos = insertAt(this.session, this.origin, text, pos)
    }
    this.updateCursor(endPos)
    if (text.length > 0) {
      this.completedMutations.push({ kind: 'insert_text', insertedChars: text.length })
    }
    return { ok: true, insertedChars: text.length }
  }

  deleteSelection(): { ok: true; deleted: boolean } {
    this.throwIfAborted()
    const selection = this.resolveSelection()
    if (!selection) {
      return { ok: true, deleted: false }
    }
    const endPos = deleteRange(this.session, this.origin, selection.from, selection.to)
    this.clearSelectionInternal()
    this.updateCursor(endPos)
    this.completedMutations.push({ kind: 'delete_selection' })
    return { ok: true, deleted: true }
  }

  startStreamingEdit(
    mode: AgentRunMode,
    contentFormat: ContentFormat = 'plain_text',
  ): { ok: true; editSessionId: string; mode: AgentRunMode; contentFormat: ContentFormat } {
    this.throwIfAborted()
    if (this.activeEdit) {
      throw new Error('A streaming edit is already active')
    }
    let insertAnchorBytes: Uint8Array | undefined
    let rewriteStartBytes: Uint8Array | undefined
    let rewriteEndBytes: Uint8Array | undefined
    let deletedSelectionText: string | undefined

    if (mode === 'rewrite') {
      const selection = this.resolveSelection()
      if (!selection) {
        throw new Error('Rewrite requires an active selection')
      }
      const { doc } = this.getMapping()
      deletedSelectionText = doc.textBetween(selection.from, selection.to, '\n\n', '\n')
      const deletePos = deleteRange(this.session, this.origin, selection.from, selection.to)
      const { meta } = this.getMapping()
      const mapping = meta.mapping as ProsemirrorMapping
      insertAnchorBytes = encodeAnchorAt(this.session, deletePos, mapping)
      rewriteStartBytes = encodeAnchorAt(this.session, deletePos, mapping)
      rewriteEndBytes = rewriteStartBytes
      this.cursorAnchorBytes = insertAnchorBytes
      this.clearSelectionInternal()
      this.session.setCursorFromAbsolute(deletePos, mapping)
    } else if (mode === 'continue') {
      const { doc, meta } = this.getMapping()
      const end = TextSelection.atEnd(doc).from
      insertAnchorBytes = encodeAnchorAt(this.session, end, meta.mapping as ProsemirrorMapping)
      this.cursorAnchorBytes = insertAnchorBytes
      this.session.setCursorFromAbsolute(end, meta.mapping as ProsemirrorMapping)
      this.clearSelectionInternal()
    } else {
      this.ensureCursorAtEnd()
      insertAnchorBytes = this.cursorAnchorBytes
      this.clearSelectionInternal()
    }

    this.activeEdit = {
      id: crypto.randomUUID(),
      mode,
      contentFormat,
      insertAnchorBytes,
      rewriteStartBytes,
      rewriteEndBytes,
      buffer: '',
      committedChars: 0,
      rewrittenText: '',
      markdownSource: '',
      renderedMarkdownDoc: null,
      markdownState: contentFormat === 'markdown' ? createStreamingMarkdownState() : null,
      deletedSelectionText,
    }
    this.session.setStatus('thinking')
    this.session.setTail(null)
    return { ok: true, editSessionId: this.activeEdit.id, mode, contentFormat }
  }

  isStreamingEditActive(): boolean {
    return this.activeEdit !== null
  }

  getActiveStreamingEditInfo(): { mode: AgentRunMode; contentFormat: ContentFormat } | null {
    if (!this.activeEdit) return null
    return {
      mode: this.activeEdit.mode,
      contentFormat: this.activeEdit.contentFormat,
    }
  }

  private insertMarkdownDocument(
    edit: ActiveStreamingEdit,
  ): { endPos: number; nextInsertAnchorBytes?: Uint8Array; insertedChars: number } | null {
    if (!edit.markdownState) {
      return null
    }
    const parsedDoc = streamStateToProsemirrorDoc(edit.markdownState)
    if (isEffectivelyEmptyMarkdownDoc(parsedDoc)) {
      return null
    }
    const diff = diffMarkdownDocsForAppend(edit.renderedMarkdownDoc, parsedDoc)
    if (!diff.canApply) {
      return null
    }
    const { doc, meta } = this.getMapping()
    const mapping = meta.mapping as ProsemirrorMapping
    const pos = resolveAnchor(this.session, mapping, edit.insertAnchorBytes)
    if (pos === null) return null

    const emptyBootstrapDoc =
      doc.childCount === 1 &&
      doc.firstChild?.type === schema.nodes.paragraph &&
      doc.firstChild.content.size === 0
    if (edit.renderedMarkdownDoc === null && emptyBootstrapDoc) {
      const inserted = replaceRangeWithFragment(this.session, this.origin, 0, doc.content.size, parsedDoc.content)
      edit.renderedMarkdownDoc = parsedDoc
      const { meta: nextMeta } = this.getMapping()
      const nextMapping = nextMeta.mapping as ProsemirrorMapping
      return {
        endPos: inserted.endPos,
        nextInsertAnchorBytes: encodeAnchorAt(this.session, inserted.tailTextPos, nextMapping),
        insertedChars: edit.markdownSource.length,
      }
    }

    let currentPos = pos
    let insertedChars = 0
    let changed = false
    let nextAnchorPos = pos

    if (diff.appendToLastBlock && diff.appendToLastBlock.fragment.size > 0) {
      const latestDoc = changed ? this.getMapping().doc : doc
      const targetPos =
        insertionPosAtEndOfNode(latestDoc, diff.appendToLastBlock.path) ?? currentPos
      const inserted = replaceRangeWithFragment(
        this.session,
        this.origin,
        targetPos,
        targetPos,
        diff.appendToLastBlock.fragment,
      )
      currentPos = inserted.endPos
      nextAnchorPos = inserted.tailTextPos
      changed = true
    }

    const appendedBlocks = diff.appendedBlocks?.nodes ?? []
    if (appendedBlocks.length > 0) {
      const latestDoc = changed ? this.getMapping().doc : doc
      const blockPos =
        insertionPosAtEndOfNode(latestDoc, diff.appendedBlocks?.path ?? []) ??
        resolveBlockInsertPos(latestDoc, currentPos)
      const inserted = replaceRangeWithFragment(
        this.session,
        this.origin,
        blockPos,
        blockPos,
        PMFragment.fromArray(appendedBlocks),
      )
      currentPos = inserted.endPos
      nextAnchorPos = inserted.tailTextPos
      changed = true
    }

    if (!changed) {
      return {
        endPos: currentPos,
        nextInsertAnchorBytes: edit.insertAnchorBytes,
        insertedChars: 0,
      }
    }

    insertedChars = edit.markdownSource.length
    edit.renderedMarkdownDoc = parsedDoc
    const { meta: nextMeta } = this.getMapping()
    const nextMapping = nextMeta.mapping as ProsemirrorMapping
    return {
      endPos: currentPos,
      nextInsertAnchorBytes: encodeAnchorAt(this.session, nextAnchorPos, nextMapping),
      insertedChars,
    }
  }

  async pushStreamingText(delta: string): Promise<void> {
    this.throwIfAborted()
    const edit = this.activeEdit
    if (!edit || delta.length === 0) return
    if (edit.contentFormat === 'markdown') {
      if (!edit.markdownState) {
        edit.markdownState = createStreamingMarkdownState()
      }
      writeStreamingMarkdown(edit.markdownState, delta)
      edit.markdownSource += delta
      edit.buffer = ''
      this.session.setTail(null)
      this.session.setStatus('composing')
      if (edit.mode === 'rewrite') {
        edit.rewrittenText = edit.markdownSource
        edit.committedChars = edit.markdownSource.length
      }
      const inserted = this.insertMarkdownDocument(edit)
      if (!inserted) return
      edit.committedChars = inserted.insertedChars
      edit.insertAnchorBytes = inserted.nextInsertAnchorBytes
      this.updateCursor(inserted.endPos)
      return
    }
    edit.buffer += delta
    const { stable, rest } = takeStablePrefix(edit.buffer)
    edit.buffer = rest
    this.session.setTail(edit.buffer.length > 0 ? edit.buffer : null)
    if (stable.length === 0) return

    this.session.setStatus('composing')
    const { meta } = this.getMapping()
    const mapping = meta.mapping as ProsemirrorMapping
    const pos = resolveAnchor(this.session, mapping, edit.insertAnchorBytes)
    if (pos === null) return
    const endPos = insertAt(this.session, this.origin, stable, pos)
    edit.committedChars += stable.length
    const { meta: mapMeta2 } = this.getMapping()
    edit.insertAnchorBytes = encodeAnchorAt(this.session, endPos, mapMeta2.mapping as ProsemirrorMapping)
    this.updateCursor(endPos)
  }

  stopStreamingEdit(cancelled: boolean = false): { ok: true; committedChars: number; cancelled?: boolean } {
    const edit = this.activeEdit
    if (!edit) {
      return { ok: true, committedChars: 0, cancelled }
    }

    if (!cancelled && edit.contentFormat === 'markdown' && edit.markdownState) {
      endStreamingMarkdown(edit.markdownState)
    }

    if (!cancelled && edit.contentFormat === 'markdown') {
      const inserted = this.insertMarkdownDocument(edit)
      if (inserted) {
        edit.committedChars = inserted.insertedChars
        edit.insertAnchorBytes = inserted.nextInsertAnchorBytes
        this.updateCursor(inserted.endPos)
      }
    } else if (!cancelled && edit.buffer.length > 0) {
      const { meta } = this.getMapping()
      const mapping = meta.mapping as ProsemirrorMapping
      const pos = resolveAnchor(this.session, mapping, edit.insertAnchorBytes)
      if (pos !== null) {
        const endPos = insertAt(this.session, this.origin, edit.buffer, pos)
        edit.committedChars += edit.buffer.length
        const { meta: mapMeta2 } = this.getMapping()
        edit.insertAnchorBytes = encodeAnchorAt(this.session, endPos, mapMeta2.mapping as ProsemirrorMapping)
        this.updateCursor(endPos)
      }
    }

    if (cancelled && edit.committedChars === 0 && edit.deletedSelectionText && edit.insertAnchorBytes) {
      const { meta } = this.getMapping()
      const mapping = meta.mapping as ProsemirrorMapping
      const pos = resolveAnchor(this.session, mapping, edit.insertAnchorBytes)
      if (pos !== null) {
        const endPos = insertAt(this.session, this.origin, edit.deletedSelectionText, pos)
        this.updateCursor(endPos)
      }
    }

    const result = {
      ok: true as const,
      committedChars: edit.committedChars,
      ...(cancelled ? { cancelled: true } : {}),
    }
    if (edit.committedChars > 0) {
      this.completedMutations.push({
        kind: 'streaming_edit',
        mode: edit.mode,
        contentFormat: edit.contentFormat,
        committedChars: edit.committedChars,
        ...(cancelled ? { cancelled: true } : {}),
      })
    }
    this.activeEdit = null
    this.session.setTail(null)
    this.session.setStatus('idle')
    return result
  }

  async destroy(): Promise<void> {
    this.session.clearCursor()
    this.session.setTail(null)
    this.session.setStatus('idle')
    await this.session.destroy()
  }
}
