export interface StablePrefixResult {
  stable: string
  rest: string
}

function hasBalancedInlineDelimiters(text: string): boolean {
  const unescapedCount = (needle: string) => {
    let count = 0
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== needle) continue
      if (i > 0 && text[i - 1] === '\\') continue
      count++
    }
    return count
  }

  const fenceCount = (text.match(/(^|\n)```/g) ?? []).length
  if (fenceCount % 2 !== 0) return false

  if (unescapedCount('`') % 2 !== 0) return false
  if ((text.match(/(?<!\\)\*\*/g) ?? []).length % 2 !== 0) return false
  if ((text.match(/(?<!\\)__/g) ?? []).length % 2 !== 0) return false

  return true
}

function findLastMarkdownBoundary(buffer: string): number {
  let cut = -1

  for (let i = 0; i < buffer.length - 1; i++) {
    if (buffer[i] === '\n' && buffer[i + 1] === '\n') {
      const candidate = buffer.slice(0, i + 2)
      if (hasBalancedInlineDelimiters(candidate)) {
        cut = i + 2
      }
    }
  }

  const lines = buffer.split('\n')
  let offset = 0
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i]!
    const nextOffset = offset + line.length + 1
    if (/^\s{0,3}(#{1,6})\s/.test(line)) {
      const candidate = buffer.slice(0, nextOffset)
      if (hasBalancedInlineDelimiters(candidate)) {
        cut = Math.max(cut, nextOffset)
      }
    }
    offset = nextOffset
  }

  return cut
}

export function takeStableMarkdownPrefix(
  buffer: string,
  opts?: { maxHold?: number },
): StablePrefixResult {
  const maxHold = opts?.maxHold ?? 240
  if (buffer.length === 0) {
    return { stable: '', rest: '' }
  }

  const cut = findLastMarkdownBoundary(buffer)
  if (cut > 0) {
    return {
      stable: buffer.slice(0, cut),
      rest: buffer.slice(cut),
    }
  }

  if (buffer.length >= maxHold && hasBalancedInlineDelimiters(buffer)) {
    const lines = buffer.split('\n')
    if (lines.length > 1) {
      const stable = lines.slice(0, -1).join('\n') + '\n'
      return {
        stable,
        rest: buffer.slice(stable.length),
      }
    }
  }

  return { stable: '', rest: buffer }
}
