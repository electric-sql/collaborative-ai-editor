import type { Node as PMNode } from 'prosemirror-model'
import * as Y from 'yjs'
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
} from 'y-prosemirror'

/** y-prosemirror internal mapping type */
export type ProsemirrorMapping = Map<Y.AbstractType<unknown>, PMNode | PMNode[]>

/**
 * Encode an absolute ProseMirror position (in the doc bound to `fragment`)
 * as a portable Yjs relative position.
 */
export function encodeAnchor(
  fragment: Y.XmlFragment,
  mapping: ProsemirrorMapping,
  absolutePos: number,
): Uint8Array {
  const rel = absolutePositionToRelativePosition(absolutePos, fragment, mapping as never)
  return Y.encodeRelativePosition(rel)
}

/**
 * Resolve a previously encoded anchor back to an absolute PM position, or `null` if invalid.
 */
export function decodeAnchor(
  ydoc: Y.Doc,
  fragment: Y.XmlFragment,
  mapping: ProsemirrorMapping,
  encoded: Uint8Array,
): number | null {
  const rel = Y.decodeRelativePosition(encoded)
  return relativePositionToAbsolutePosition(ydoc, fragment, rel, mapping as never)
}

function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!)
  return btoa(s)
}

function base64ToUint8(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'))
  }
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Encode a relative anchor for JSON transport (base64). */
export function encodeAnchorBase64(
  fragment: Y.XmlFragment,
  mapping: ProsemirrorMapping,
  absolutePos: number,
): string {
  return uint8ToBase64(encodeAnchor(fragment, mapping, absolutePos))
}

export function decodeAnchorBase64(b64: string): Uint8Array {
  return base64ToUint8(b64)
}
