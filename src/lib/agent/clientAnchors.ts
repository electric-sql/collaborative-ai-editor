import { TextSelection } from 'prosemirror-state'
import type { EditorState } from 'prosemirror-state'
import * as Y from 'yjs'
import { initProseMirrorDoc } from 'y-prosemirror'
import { encodeAnchorBase64 } from './relativeAnchors'
import type { ProsemirrorMapping } from './relativeAnchors'
import { schema } from '../editor/schema'
import type { AgentRunMode } from './types'

/** Selection spans a single textblock (rewrite limited to plain text in one block). */
export function selectionIsSingleTextblock(state: EditorState): boolean {
  const { $from, $to } = state.selection
  if (!$from.parent.isTextblock || !$to.parent.isTextblock) return false
  return $from.parent === $to.parent
}

export function encodeAnchorsForAgentRun(
  fragment: Y.XmlFragment,
  state: EditorState,
  mode: AgentRunMode,
): {
  insertAnchorB64?: string
  rewriteStartB64?: string
  rewriteEndB64?: string
} {
  const { meta } = initProseMirrorDoc(fragment, schema)
  const mapping = meta.mapping as ProsemirrorMapping
  const { doc, selection } = state

  if (mode === 'rewrite') {
    const from = Math.min(selection.anchor, selection.head)
    const to = Math.max(selection.anchor, selection.head)
    return {
      rewriteStartB64: encodeAnchorBase64(fragment, mapping, from),
      rewriteEndB64: encodeAnchorBase64(fragment, mapping, to),
    }
  }

  if (mode === 'continue') {
    const pos = TextSelection.atEnd(doc).from
    return { insertAnchorB64: encodeAnchorBase64(fragment, mapping, pos) }
  }

  return { insertAnchorB64: encodeAnchorBase64(fragment, mapping, selection.anchor) }
}
