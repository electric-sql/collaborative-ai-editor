import { describe, expect, it } from 'vitest'
import { DocumentToolRuntime } from '../../src/lib/agent/documentToolRuntime'
import { applyExternalInsert, createTestSession, readDocJson, readDocText } from './testUtils'

describe('DocumentToolRuntime unit tests', () => {
  it('returns a paged snapshot window with startChar', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    runtime.insertText('abcdefghi')

    expect(runtime.getDocumentSnapshot(4, 2)).toEqual({
      text: 'cdef',
      charCount: 9,
      startChar: 2,
      endChar: 6,
    })

    runtime.destroy()
  })

  it('clamps snapshot windows when startChar is past the end', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    runtime.insertText('abc')

    expect(runtime.getDocumentSnapshot(10, 999)).toEqual({
      text: '',
      charCount: 3,
      startChar: 3,
      endChar: 3,
    })

    runtime.destroy()
  })

  it('searches, selects, and replaces the selected text', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    runtime.insertText('Hello world')
    const [match] = runtime.searchText('world')
    expect(match?.text).toBe('world')

    runtime.selectText(match!.matchId)
    runtime.insertText('friend')

    expect(readDocText(session)).toBe('Hello friend')

    runtime.destroy()
  })

  it('streams insert-mode text progressively into the document', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    runtime.insertText('Hello')
    runtime.startStreamingEdit('continue')

    await runtime.pushStreamingText(' there')
    expect(readDocText(session)).toBe('Hello ')

    await runtime.pushStreamingText(' friend.')
    expect(readDocText(session)).toBe('Hello there friend.')

    const result = runtime.stopStreamingEdit(false)
    expect(result.committedChars).toBeGreaterThan(0)
    expect(readDocText(session)).toBe('Hello there friend.')

    runtime.destroy()
  })

  it('streams rewrite-mode text into the selected range', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    runtime.insertText('One bad sentence.')
    const [match] = runtime.searchText('bad')
    runtime.selectText(match!.matchId)

    runtime.startStreamingEdit('rewrite')
    await runtime.pushStreamingText('good')
    runtime.stopStreamingEdit(false)

    expect(readDocText(session)).toBe('One good sentence.')

    runtime.destroy()
  })

  it('keeps insert anchors stable across external edits', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    runtime.insertText('Hello world')
    const [match] = runtime.searchText('world')
    runtime.placeCursor(match!.matchId, 'start')
    runtime.startStreamingEdit('insert')

    applyExternalInsert(session, 1, 'Hey! ')
    await runtime.pushStreamingText('beautiful ')
    runtime.stopStreamingEdit(false)

    expect(readDocText(session)).toBe('Hey! Hello beautiful world')

    runtime.destroy()
  })

  it('deletes the current selection only when one exists', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    runtime.insertText('alpha beta')
    expect(runtime.deleteSelection()).toEqual({ ok: true, deleted: false })

    const [match] = runtime.searchText('beta')
    runtime.selectText(match!.matchId)
    expect(runtime.deleteSelection()).toEqual({ ok: true, deleted: true })
    expect(readDocText(session)).toBe('alpha ')

    runtime.destroy()
  })

  it('selects a range between two matches using edge variants', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    runtime.insertText('alpha beta gamma delta')
    const [beta] = runtime.searchText('beta')
    const [delta] = runtime.searchText('delta')

    runtime.selectBetweenMatches(beta!.matchId, delta!.matchId, 'end', 'start')
    runtime.insertText(' -> ')

    expect(readDocText(session)).toBe('alpha beta -> delta')

    runtime.destroy()
  })

  it('places the cursor at document boundaries', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    runtime.insertText('alpha beta')
    runtime.placeCursorAtDocumentBoundary('start')
    runtime.insertText('START ')
    runtime.placeCursorAtDocumentBoundary('end')
    runtime.insertText(' END')

    expect(readDocText(session)).toBe('START alpha beta END')

    runtime.destroy()
  })

  it('applies mark formatting to the current selection', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    runtime.insertText('alpha beta')
    const [match] = runtime.searchText('beta')
    runtime.selectText(match!.matchId)
    runtime.setFormat({ kind: 'mark', format: 'bold', action: 'add' })

    expect(readDocJson(session)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'alpha ' },
            { type: 'text', text: 'beta', marks: [{ type: 'strong' }] },
          ],
        },
      ],
    })

    runtime.destroy()
  })

  it('applies block formatting to the current selection', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    runtime.insertText('alpha beta')
    const [match] = runtime.searchText('alpha')
    runtime.selectText(match!.matchId)
    runtime.setFormat({ kind: 'block', format: 'heading', action: 'set', level: 2 })

    expect(readDocJson(session)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'alpha beta' }],
        },
      ],
    })

    runtime.destroy()
  })

  it('applies list formatting to the current selection', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    runtime.insertText('alpha beta')
    const [match] = runtime.searchText('alpha')
    runtime.selectText(match!.matchId)
    runtime.setFormat({ kind: 'block', format: 'bullet_list', action: 'set' })

    expect(readDocJson(session)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'bullet_list',
          content: [
            {
              type: 'list_item',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'alpha beta' }] }],
            },
          ],
        },
      ],
    })

    runtime.destroy()
  })

  it('clears selection and keeps later inserts at the current cursor target', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    runtime.insertText('alpha beta')
    const [match] = runtime.searchText('alpha')
    runtime.placeCursor(match!.matchId, 'end')
    runtime.selectText(match!.matchId)
    runtime.clearSelection()
    runtime.insertText('!')

    expect(readDocText(session)).toBe('alpha! beta')

    runtime.destroy()
  })

  it('throws when rewrite streaming starts without a selection', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    expect(() => runtime.startStreamingEdit('rewrite')).toThrow('Rewrite requires an active selection')

    runtime.destroy()
  })

  it('throws when a second streaming edit is started while one is active', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    runtime.startStreamingEdit('continue')

    expect(() => runtime.startStreamingEdit('insert')).toThrow('A streaming edit is already active')

    runtime.destroy()
  })

  it('returns a zeroed result when stopStreamingEdit runs without an active edit', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    expect(runtime.stopStreamingEdit(false)).toEqual({ ok: true, committedChars: 0, cancelled: false })

    runtime.destroy()
  })
})
