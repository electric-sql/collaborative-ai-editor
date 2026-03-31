import { describe, expect, it } from 'vitest'
import { DocumentToolRuntime } from '../../src/lib/agent/documentToolRuntime'
import { createDocumentTools } from '../../src/lib/agent/documentTools'
import { applyExternalInsert, createTestSession, readDocText } from './testUtils'

function createToolMap(runtime: DocumentToolRuntime) {
  return new Map(createDocumentTools(runtime).map((tool) => [tool.name, tool]))
}

async function searchOne(
  tools: ReturnType<typeof createToolMap>,
  query: string,
  maxResults: number = 1,
) {
  const result = (await tools.get('search_text')!.execute?.({ query, maxResults })) as {
    ok: true
    matches: Array<{ matchId: string }>
  }
  return result.matches[0]!
}

describe('natural prompt scenario unit tests', () => {
  it('write me a short story writes prose into the document', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const tools = createToolMap(runtime)

    await tools.get('start_streaming_edit')!.execute?.({ mode: 'continue' })
    await runtime.pushStreamingText('Once upon a time, there was a lantern in the sea.')
    await tools.get('stop_streaming_edit')!.execute?.({})

    expect(readDocText(session)).toBe('Once upon a time, there was a lantern in the sea.')
    runtime.destroy()
  })

  it('continue this paragraph appends new prose to the end', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const tools = createToolMap(runtime)

    await tools.get('insert_text')!.execute?.({ text: 'The rain stopped at dawn.' })
    await tools.get('start_streaming_edit')!.execute?.({ mode: 'continue' })
    await runtime.pushStreamingText(' The streets steamed in the first light.')
    await tools.get('stop_streaming_edit')!.execute?.({})

    expect(readDocText(session)).toBe('The rain stopped at dawn. The streets steamed in the first light.')
    runtime.destroy()
  })

  it('draft an introduction about AI safety starts from an empty document', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const tools = createToolMap(runtime)

    await tools.get('start_streaming_edit')!.execute?.({ mode: 'continue' })
    await runtime.pushStreamingText('AI safety is the practice of building systems that remain useful, reliable, and aligned with human intent.')
    await tools.get('stop_streaming_edit')!.execute?.({})

    expect(readDocText(session)).toContain('AI safety is the practice')
    runtime.destroy()
  })

  it('add a sentence after beta inserts text at the end of the matched phrase', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const tools = createToolMap(runtime)

    await tools.get('insert_text')!.execute?.({ text: 'alpha beta gamma' })
    const beta = await searchOne(tools, 'beta')
    await tools.get('place_cursor')!.execute?.({ matchId: beta.matchId, edge: 'end' })
    await tools.get('insert_text')!.execute?.({ text: ' and then a coda' })

    expect(readDocText(session)).toBe('alpha beta and then a coda gamma')
    runtime.destroy()
  })

  it('insert a note before beta places the cursor at the start edge', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const tools = createToolMap(runtime)

    await tools.get('insert_text')!.execute?.({ text: 'alpha beta gamma' })
    const beta = await searchOne(tools, 'beta')
    await tools.get('place_cursor')!.execute?.({ matchId: beta.matchId, edge: 'start' })
    await tools.get('insert_text')!.execute?.({ text: '[note] ' })

    expect(readDocText(session)).toBe('alpha [note] beta gamma')
    runtime.destroy()
  })

  it('replace beta with gamma uses selection replacement', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const tools = createToolMap(runtime)

    await tools.get('insert_text')!.execute?.({ text: 'alpha beta gamma' })
    const beta = await searchOne(tools, 'beta')
    await tools.get('select_text')!.execute?.({ matchId: beta.matchId })
    await tools.get('insert_text')!.execute?.({ text: 'delta' })

    expect(readDocText(session)).toBe('alpha delta gamma')
    runtime.destroy()
  })

  it('delete beta removes only the selected word', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const tools = createToolMap(runtime)

    await tools.get('insert_text')!.execute?.({ text: 'alpha beta gamma' })
    const beta = await searchOne(tools, 'beta')
    await tools.get('select_text')!.execute?.({ matchId: beta.matchId })
    await tools.get('delete_selection')!.execute?.({})

    expect(readDocText(session)).toBe('alpha  gamma')
    runtime.destroy()
  })

  it('rewrite the phrase bad into good streams a rewrite into the selected text', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const tools = createToolMap(runtime)

    await tools.get('insert_text')!.execute?.({ text: 'One bad sentence.' })
    const bad = await searchOne(tools, 'bad')
    await tools.get('select_text')!.execute?.({ matchId: bad.matchId })
    await tools.get('start_streaming_edit')!.execute?.({ mode: 'rewrite' })
    await runtime.pushStreamingText('good')
    await tools.get('stop_streaming_edit')!.execute?.({})

    expect(readDocText(session)).toBe('One good sentence.')
    runtime.destroy()
  })

  it('rewrite this sentence to be shorter can replace a longer selected sentence', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const tools = createToolMap(runtime)

    await tools.get('insert_text')!.execute?.({
      text: 'This sentence is long and winding. Another line.',
    })
    const first = await searchOne(tools, 'This sentence is long and winding.')
    await tools.get('select_text')!.execute?.({ matchId: first.matchId })
    await tools.get('start_streaming_edit')!.execute?.({ mode: 'rewrite' })
    await runtime.pushStreamingText('This sentence is brief.')
    await tools.get('stop_streaming_edit')!.execute?.({})

    expect(readDocText(session)).toBe('This sentence is brief. Another line.')
    runtime.destroy()
  })

  it('replace everything between alpha and delta with bridge text uses range selection', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const tools = createToolMap(runtime)

    await tools.get('insert_text')!.execute?.({ text: 'alpha beta gamma delta' })
    const alpha = await searchOne(tools, 'alpha')
    const delta = await searchOne(tools, 'delta')
    await tools.get('select_between_matches')!.execute?.({
      startMatchId: alpha.matchId,
      endMatchId: delta.matchId,
      startEdge: 'end',
      endEdge: 'start',
    })
    await tools.get('insert_text')!.execute?.({ text: ' -> ' })

    expect(readDocText(session)).toBe('alpha -> delta')
    runtime.destroy()
  })

  it('add a title at the start inserts before the first matched content', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const tools = createToolMap(runtime)

    await tools.get('insert_text')!.execute?.({ text: 'Opening paragraph' })
    const opening = await searchOne(tools, 'Opening')
    await tools.get('place_cursor')!.execute?.({ matchId: opening.matchId, edge: 'start' })
    await tools.get('insert_text')!.execute?.({ text: 'Title: Dawn\n' })

    expect(readDocText(session)).toBe('Title: Dawn\nOpening paragraph')
    runtime.destroy()
  })

  it('add a closing sentence at the end uses continue mode', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const tools = createToolMap(runtime)

    await tools.get('insert_text')!.execute?.({ text: 'Body text.' })
    await tools.get('start_streaming_edit')!.execute?.({ mode: 'continue' })
    await runtime.pushStreamingText(' Final thought.')
    await tools.get('stop_streaming_edit')!.execute?.({})

    expect(readDocText(session)).toBe('Body text. Final thought.')
    runtime.destroy()
  })

  it('edit the second beta only uses a later search match', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const tools = createToolMap(runtime)

    await tools.get('insert_text')!.execute?.({ text: 'beta one beta two' })
    const search = (await tools.get('search_text')!.execute?.({ query: 'beta', maxResults: 2 })) as {
      ok: true
      matches: Array<{ matchId: string }>
    }
    await tools.get('select_text')!.execute?.({ matchId: search.matches[1]!.matchId })
    await tools.get('insert_text')!.execute?.({ text: 'delta' })

    expect(readDocText(session)).toBe('beta one delta two')
    runtime.destroy()
  })

  it('review the later part of a document can use paged snapshots before editing', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const tools = createToolMap(runtime)

    await tools.get('insert_text')!.execute?.({ text: 'alpha beta gamma delta epsilon zeta' })
    const snapshot = await tools.get('get_document_snapshot')!.execute?.({ startChar: 17, maxChars: 12 })

    expect(snapshot).toEqual({
      text: 'delta epsilo',
      charCount: 35,
      startChar: 17,
      endChar: 29,
    })
    runtime.destroy()
  })

  it('continue writing while a collaborator edits nearby keeps the insertion semantically anchored', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const tools = createToolMap(runtime)

    await tools.get('insert_text')!.execute?.({ text: 'Hello world' })
    const world = await searchOne(tools, 'world')
    await tools.get('place_cursor')!.execute?.({ matchId: world.matchId, edge: 'start' })
    await tools.get('start_streaming_edit')!.execute?.({ mode: 'insert' })
    applyExternalInsert(session, 1, 'Hey! ')
    await runtime.pushStreamingText('beautiful ')
    await tools.get('stop_streaming_edit')!.execute?.({})

    expect(readDocText(session)).toBe('Hey! Hello beautiful world')
    runtime.destroy()
  })

  it('stop writing now can cancel an in-flight streaming edit and drop the buffered tail', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const tools = createToolMap(runtime)

    await tools.get('insert_text')!.execute?.({ text: 'Start' })
    await tools.get('start_streaming_edit')!.execute?.({ mode: 'continue' })
    await runtime.pushStreamingText('unfinished')
    const result = runtime.stopStreamingEdit(true)

    expect(result).toEqual({ ok: true, committedChars: 0, cancelled: true })
    expect(readDocText(session)).toBe('Start')
    runtime.destroy()
  })
})
