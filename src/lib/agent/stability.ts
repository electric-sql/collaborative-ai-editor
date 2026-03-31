/**
 * Decide what portion of the streaming buffer is safe to commit to Yjs
 * (avoid per-token CRDT churn while keeping visible progress).
 */

const BOUNDARY_CHARS = new Set([' ', '\n', '\t', '.', ',', ';', ':', '!', '?', '—', '-'])

export interface StablePrefixResult {
  /** Substring that can be committed to the document */
  stable: string
  /** Remaining buffer to accumulate further chunks */
  rest: string
}

/**
 * Returns a stable prefix when the buffer ends at a word / punctuation boundary,
 * or when the buffer grows large enough to flush (length heuristic).
 */
export function takeStablePrefix(buffer: string, opts?: { maxHold?: number }): StablePrefixResult {
  const maxHold = opts?.maxHold ?? 96
  if (buffer.length === 0) {
    return { stable: '', rest: '' }
  }

  if (buffer.length >= maxHold) {
    const split = Math.max(0, maxHold - 24)
    return { stable: buffer.slice(0, split), rest: buffer.slice(split) }
  }

  let cut = -1
  for (let i = buffer.length - 1; i >= 0; i--) {
    const c = buffer[i]!
    if (BOUNDARY_CHARS.has(c)) {
      cut = i + 1
      break
    }
  }

  if (cut <= 0) {
    return { stable: '', rest: buffer }
  }

  return {
    stable: buffer.slice(0, cut),
    rest: buffer.slice(cut),
  }
}
