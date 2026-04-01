import { describe, expect, it } from 'vitest'
import { parseMarkdownDocument } from '../../src/lib/agent/markdownToProsemirror'
import { DocumentToolRuntime } from '../../src/lib/agent/documentToolRuntime'
import { createTestSession, readDocJson, readDocText } from './testUtils'

describe('markdown streaming unit tests', () => {
  it('parses headings, marks, and lists with the streaming markdown pipeline', () => {
    const doc = parseMarkdownDocument('# Title\n\nParagraph with **bold** and *italic* and `code`.\n\n- one\n- two')

    expect(doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Paragraph with ' },
            { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'italic', marks: [{ type: 'em' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'code', marks: [{ type: 'code' }] },
            { type: 'text', text: '.' },
          ],
        },
        {
          type: 'bullet_list',
          content: [
            {
              type: 'list_item',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
            },
            {
              type: 'list_item',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
            },
          ],
        },
      ],
    })
  })

  it('streams markdown insertion into structured document nodes', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    runtime.startStreamingEdit('continue', 'markdown')
    await runtime.pushStreamingText('# Title\n\n')
    await runtime.pushStreamingText('Paragraph with **bold** text.\n\n- one\n- two')
    runtime.stopStreamingEdit(false)

    expect(readDocJson(session)).toEqual({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Paragraph with ' },
            { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
            { type: 'text', text: ' text.' },
          ],
        },
        {
          type: 'bullet_list',
          content: [
            {
              type: 'list_item',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
            },
            {
              type: 'list_item',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
            },
          ],
        },
      ],
    })

    runtime.destroy()
  })

  it('rewrites a selected range using markdown emphasis', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    runtime.insertText('Replace me please.')
    const [match] = runtime.searchText('Replace me please.')
    runtime.selectText(match!.matchId)

    runtime.startStreamingEdit('rewrite', 'markdown')
    await runtime.pushStreamingText('Make this **stronger**.')
    runtime.stopStreamingEdit(false)

    expect(readDocJson(session)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Make this ' },
            { type: 'text', text: 'stronger', marks: [{ type: 'strong' }] },
            { type: 'text', text: '.' },
          ],
        },
      ],
    })

    expect(readDocText(session)).toBe('Make this stronger.')
    runtime.destroy()
  })

  it('inserts a streamed markdown title at the top of a non-empty document', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    runtime.insertText('At dawn, Mira found a key in the garden.')
    runtime.placeCursorAtDocumentBoundary('start')
    runtime.startStreamingEdit('insert', 'markdown')
    await runtime.pushStreamingText('# Key')
    await runtime.pushStreamingText(' to Evening\n\n')
    runtime.stopStreamingEdit(false)

    expect(readDocJson(session)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Key to Evening' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'At dawn, Mira found a key in the garden.' }],
        },
      ],
    })

    runtime.destroy()
  })

})
