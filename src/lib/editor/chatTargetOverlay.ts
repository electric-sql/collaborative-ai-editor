import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import { initProseMirrorDoc } from 'y-prosemirror'
import type * as Y from 'yjs'
import { schema } from './schema'
import { decodeAnchor, decodeAnchorBase64, type ProsemirrorMapping } from '../agent/relativeAnchors'
import type { EditorContextPayload } from '../agent/editorContext'

type ChatTargetOverlayState = {
  active: boolean
  context: EditorContextPayload | null
}

const EMPTY_STATE: ChatTargetOverlayState = {
  active: false,
  context: null,
}

export const chatTargetOverlayKey = new PluginKey<ChatTargetOverlayState>('chat-target-overlay')

function clampDecorationPos(doc: PMNode, pos: number): number {
  return Math.max(0, Math.min(pos, doc.content.size))
}

function normalizeCursorDecorationPos(doc: PMNode, pos: number): number {
  const clamped = clampDecorationPos(doc, pos)
  const start = TextSelection.atStart(doc).from
  const end = TextSelection.atEnd(doc).from
  if (clamped <= start) return start
  if (clamped >= end) return end
  try {
    return TextSelection.near(doc.resolve(clamped), 1).from
  } catch {
    return start
  }
}

function buildCursorDecoration(doc: PMNode, pos: number): Decoration {
  return Decoration.widget(normalizeCursorDecorationPos(doc, pos), () => {
    const span = document.createElement('span')
    span.className = 'chat-target-cursor'
    span.setAttribute('aria-hidden', 'true')
    return span
  })
}

function buildDecorations(
  doc: PMNode,
  fragment: Y.XmlFragment,
  overlay: ChatTargetOverlayState,
): DecorationSet {
  if (!overlay.active || !overlay.context || !fragment.doc) {
    return DecorationSet.empty
  }

  const { meta } = initProseMirrorDoc(fragment, schema)
  const mapping = meta.mapping as ProsemirrorMapping

  if (overlay.context.kind === 'cursor') {
    const pos = decodeAnchor(fragment.doc, fragment, mapping, decodeAnchorBase64(overlay.context.anchor))
    return pos === null ? DecorationSet.empty : DecorationSet.create(doc, [buildCursorDecoration(doc, pos)])
  }

  const anchor = decodeAnchor(fragment.doc, fragment, mapping, decodeAnchorBase64(overlay.context.anchor))
  const head = decodeAnchor(fragment.doc, fragment, mapping, decodeAnchorBase64(overlay.context.head))
  if (anchor === null || head === null) {
    return DecorationSet.empty
  }

  const from = clampDecorationPos(doc, Math.min(anchor, head))
  const to = clampDecorationPos(doc, Math.max(anchor, head))
  if (from === to) {
    return DecorationSet.create(doc, [buildCursorDecoration(doc, from)])
  }

  return DecorationSet.create(doc, [
    Decoration.inline(from, to, {
      class: 'chat-target-selection',
    }),
  ])
}

export function createChatTargetOverlayPlugin(args: { yFragment: Y.XmlFragment }) {
  return new Plugin<ChatTargetOverlayState>({
    key: chatTargetOverlayKey,
    state: {
      init: () => EMPTY_STATE,
      apply(tr, value) {
        return (tr.getMeta(chatTargetOverlayKey) as ChatTargetOverlayState | undefined) ?? value
      },
    },
    props: {
      decorations(state) {
        const overlay = chatTargetOverlayKey.getState(state) ?? EMPTY_STATE
        return buildDecorations(state.doc, args.yFragment, overlay)
      },
    },
  })
}

export function setChatTargetOverlay(
  view: EditorView,
  next: ChatTargetOverlayState,
): void {
  const tr = view.state.tr.setMeta(chatTargetOverlayKey, next)
  view.dispatch(tr)
}
