import { describe, expect, it } from 'vitest'
import { DocumentToolRuntime } from '../../src/lib/agent/documentToolRuntime'
import { createDocumentTools } from '../../src/lib/agent/documentTools'
import { createEventCollector, createTestSession, readDocJson, readDocText } from './testUtils'

function createToolMap(runtime: DocumentToolRuntime) {
  return new Map(createDocumentTools(runtime).map((tool) => [tool.name, tool]))
}

describe('document tool unit tests', () => {
  it('exposes the full tool set', () => {
    const runtime = DocumentToolRuntime.createForSession({ session: createTestSession() })
    const names = createDocumentTools(runtime).map((tool) => tool.name)

    expect(names).toEqual([
      'get_document_snapshot',
      'search_text',
      'replace_matches',
      'place_cursor',
      'place_cursor_at_document_boundary',
      'insert_paragraph_break',
      'select_text',
      'select_current_block',
      'select_between_matches',
      'clear_selection',
      'set_format',
      'insert_text',
      'delete_selection',
      'start_streaming_edit',
      'stop_streaming_edit',
    ])

    runtime.destroy()
  })

  it('runs get_document_snapshot and search_text tools', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    runtime.insertText('alpha beta gamma beta')
    const tools = createToolMap(runtime)

    const snapshot = await tools.get('get_document_snapshot')!.execute?.({ startChar: 6, maxChars: 9 })
    const search = await tools.get('search_text')!.execute?.({ query: 'beta', maxResults: 1 })

    expect(snapshot).toEqual({
      text: 'beta gamm',
      charCount: 21,
      startChar: 6,
      endChar: 15,
    })
    expect(search).toEqual({
      ok: true,
      matches: [expect.objectContaining({ text: 'beta' })],
    })

    runtime.destroy()
  })

  it('runs cursor and selection tools and emits matching custom events', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    runtime.insertText('alpha beta gamma delta')
    const tools = createToolMap(runtime)
    const { context, events } = createEventCollector()
    const matches = (await tools.get('search_text')!.execute?.({ query: 'beta', maxResults: 1 })) as {
      ok: true
      matches: Array<{ matchId: string }>
    }
    const deltas = (await tools.get('search_text')!.execute?.({ query: 'delta', maxResults: 1 })) as {
      ok: true
      matches: Array<{ matchId: string }>
    }

    await tools.get('place_cursor')!.execute?.({ matchId: matches.matches[0]!.matchId, edge: 'end' }, context)
    await tools.get('select_text')!.execute?.({ matchId: matches.matches[0]!.matchId }, context)
    await tools.get('select_between_matches')!.execute?.(
      {
        startMatchId: matches.matches[0]!.matchId,
        endMatchId: deltas.matches[0]!.matchId,
        startEdge: 'end',
        endEdge: 'start',
      },
      context,
    )
    await tools.get('clear_selection')!.execute?.({}, context)

    expect(events.map((event) => event.name)).toEqual([
      'agent-cursor-updated',
      'agent-selection-updated',
      'agent-selection-updated',
      'agent-selection-cleared',
    ])

    runtime.destroy()
  })

  it('runs the document boundary cursor tool', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const tools = createToolMap(runtime)
    const { context, events } = createEventCollector()

    await tools.get('insert_text')!.execute?.({ text: 'body' }, context)
    await tools.get('place_cursor_at_document_boundary')!.execute?.({ boundary: 'start' }, context)
    await tools.get('insert_text')!.execute?.({ text: 'title ' }, context)

    expect(readDocText(session)).toBe('title body')
    expect(events.find((event) => event.name === 'agent-cursor-updated')).toEqual({
      name: 'agent-cursor-updated',
      value: { boundary: 'start' },
    })

    runtime.destroy()
  })

  it('runs the paragraph break tool and emits an edit event', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const tools = createToolMap(runtime)
    const { context, events } = createEventCollector()

    await tools.get('insert_text')!.execute?.({ text: 'First paragraph.' }, context)
    await tools.get('place_cursor_at_document_boundary')!.execute?.({ boundary: 'end' }, context)
    await tools.get('insert_paragraph_break')!.execute?.({}, context)
    await tools.get('insert_text')!.execute?.({ text: 'Second paragraph.' }, context)

    expect(readDocText(session)).toBe('First paragraph.\n\nSecond paragraph.')
    expect(events.filter((event) => event.name === 'agent-edit-applied')).toEqual([
      { name: 'agent-edit-applied', value: { kind: 'insert_text', chars: 16 } },
      { name: 'agent-edit-applied', value: { kind: 'insert_paragraph_break' } },
      { name: 'agent-edit-applied', value: { kind: 'insert_text', chars: 17 } },
    ])

    runtime.destroy()
  })

  it('runs the current block selection tool', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const tools = createToolMap(runtime)

    await tools.get('insert_text')!.execute?.({ text: 'body text' })
    await tools.get('place_cursor_at_document_boundary')!.execute?.({ boundary: 'end' })
    const result = await tools.get('select_current_block')!.execute?.({})

    expect(result).toEqual({ ok: true, selectedText: 'body text' })

    runtime.destroy()
  })

  it('runs insert_text and delete_selection tools', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const tools = createToolMap(runtime)
    const { context, events } = createEventCollector()

    await tools.get('insert_text')!.execute?.({ text: 'alpha beta' }, context)
    const matches = (await tools.get('search_text')!.execute?.({ query: 'beta', maxResults: 1 })) as {
      ok: true
      matches: Array<{ matchId: string }>
    }
    await tools.get('select_text')!.execute?.({ matchId: matches.matches[0]!.matchId }, context)
    await tools.get('delete_selection')!.execute?.({}, context)

    expect(readDocText(session)).toBe('alpha ')
    expect(events.filter((event) => event.name === 'agent-edit-applied')).toEqual([
      { name: 'agent-edit-applied', value: { kind: 'insert_text', chars: 10 } },
      { name: 'agent-edit-applied', value: { kind: 'delete_selection' } },
    ])

    runtime.destroy()
  })

  it('runs replace_matches across repeated exact search hits', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const tools = createToolMap(runtime)
    const { context, events } = createEventCollector()

    await tools.get('insert_text')!.execute?.({ text: 'Mara waved. Mara smiled.' }, context)
    const search = (await tools.get('search_text')!.execute?.({ query: 'Mara', maxResults: 10 })) as {
      ok: true
      matches: Array<{ matchId: string }>
    }
    const result = await tools.get('replace_matches')!.execute?.(
      { matchIds: search.matches.map((match) => match.matchId), text: 'Kiki' },
      context,
    )

    expect(result).toEqual({ ok: true, replacedCount: 2, insertedChars: 4 })
    expect(readDocText(session)).toBe('Kiki waved. Kiki smiled.')
    expect(events.filter((event) => event.name === 'agent-edit-applied')).toEqual([
      { name: 'agent-edit-applied', value: { kind: 'insert_text', chars: 24 } },
      { name: 'agent-edit-applied', value: { kind: 'replace_matches', count: 2, chars: 4 } },
    ])

    runtime.destroy()
  })

  it('runs replace_matches with markdown inline formatting', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const tools = createToolMap(runtime)

    await tools.get('insert_text')!.execute?.({ text: 'alpha beta gamma' })
    const search = (await tools.get('search_text')!.execute?.({ query: 'beta', maxResults: 1 })) as {
      ok: true
      matches: Array<{ matchId: string }>
    }
    const result = await tools.get('replace_matches')!.execute?.({
      matchIds: [search.matches[0]!.matchId],
      text: '**beta**',
      contentFormat: 'markdown',
    })

    expect(result).toEqual({ ok: true, replacedCount: 1, insertedChars: 8 })
    expect(readDocJson(session)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'alpha ' },
            { type: 'text', text: 'beta', marks: [{ type: 'strong' }] },
            { type: 'text', text: ' gamma' },
          ],
        },
      ],
    })

    runtime.destroy()
  })

  it('runs the format tool and emits a formatting event', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const tools = createToolMap(runtime)
    const { context, events } = createEventCollector()

    await tools.get('insert_text')!.execute?.({ text: 'alpha beta' }, context)
    const matches = (await tools.get('search_text')!.execute?.({ query: 'beta', maxResults: 1 })) as {
      ok: true
      matches: Array<{ matchId: string }>
    }
    await tools.get('select_text')!.execute?.({ matchId: matches.matches[0]!.matchId }, context)
    await tools.get('set_format')!.execute?.(
      { kind: 'mark', format: 'bold', action: 'add' },
      context,
    )

    expect(events.find((event) => event.name === 'agent-format-applied')).toEqual({
      name: 'agent-format-applied',
      value: { kind: 'mark', format: 'bold', action: 'add' },
    })

    runtime.destroy()
  })

  it('runs insert_text with markdown inline formatting over a selection', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const tools = createToolMap(runtime)

    await tools.get('insert_text')!.execute?.({ text: 'alpha beta gamma' })
    const matches = (await tools.get('search_text')!.execute?.({ query: 'beta', maxResults: 1 })) as {
      ok: true
      matches: Array<{ matchId: string }>
    }
    await tools.get('select_text')!.execute?.({ matchId: matches.matches[0]!.matchId })
    await tools.get('insert_text')!.execute?.({ text: '**beta**', contentFormat: 'markdown' })

    expect(readDocJson(session)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'alpha ' },
            { type: 'text', text: 'beta', marks: [{ type: 'strong' }] },
            { type: 'text', text: ' gamma' },
          ],
        },
      ],
    })

    runtime.destroy()
  })

  it('runs start_streaming_edit and stop_streaming_edit tools', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const tools = createToolMap(runtime)
    const { context, events } = createEventCollector()

    await tools.get('insert_text')!.execute?.({ text: 'Hello' }, context)
    const started = await tools.get('start_streaming_edit')!.execute?.(
      { mode: 'continue', contentFormat: 'plain_text' },
      context,
    )
    await runtime.pushStreamingText(' world')
    const stopped = await tools.get('stop_streaming_edit')!.execute?.({}, context)

    expect(started).toEqual(
      expect.objectContaining({
        ok: true,
        mode: 'continue',
        contentFormat: 'plain_text',
        editSessionId: expect.any(String),
      }),
    )
    expect(stopped).toEqual(
      expect.objectContaining({
        ok: true,
        committedChars: expect.any(Number),
      }),
    )
    expect(readDocText(session)).toBe('Hello world')
    expect(events.filter((event) => event.name === 'agent-streaming-edit')).toEqual([
      {
        name: 'agent-streaming-edit',
        value: { active: true, mode: 'continue', contentFormat: 'plain_text' },
      },
      { name: 'agent-streaming-edit', value: { active: false } },
    ])

    runtime.destroy()
  })
})
