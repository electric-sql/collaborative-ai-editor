export type EditorContextPayload =
  | {
      kind: 'cursor'
      anchor: string
    }
  | {
      kind: 'selection'
      anchor: string
      head: string
    }

export function parseEditorContextPayload(value: unknown): EditorContextPayload | undefined {
  if (!value || typeof value !== 'object') return undefined
  const input = value as Record<string, unknown>
  if (input.kind === 'cursor' && typeof input.anchor === 'string' && input.anchor.length > 0) {
    return {
      kind: 'cursor',
      anchor: input.anchor,
    }
  }
  if (
    input.kind === 'selection' &&
    typeof input.anchor === 'string' &&
    input.anchor.length > 0 &&
    typeof input.head === 'string' &&
    input.head.length > 0
  ) {
    return {
      kind: 'selection',
      anchor: input.anchor,
      head: input.head,
    }
  }
  return undefined
}
