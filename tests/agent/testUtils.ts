import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { EditorState } from 'prosemirror-state'
import { initProseMirrorDoc, updateYFragment } from 'y-prosemirror'
import type { YjsProvider } from '@durable-streams/y-durable-streams'
import type { ServerAgentSession } from '../../src/lib/agent/serverAgentSession'
import { schema } from '../../src/lib/editor/schema'

const Y_XML_FRAGMENT_KEY = 'prosemirror'

export function createFakeProvider(): YjsProvider {
  return {
    synced: true,
    on: () => undefined,
    off: () => undefined,
    destroy: () => undefined,
  } as unknown as YjsProvider
}

export function createTestSession(sessionId: string = crypto.randomUUID()): ServerAgentSession {
  const ydoc = new Y.Doc()
  const awareness = new Awareness(ydoc)
  const fragment = ydoc.getXmlFragment(Y_XML_FRAGMENT_KEY)

  return {
    ydoc,
    awareness,
    provider: createFakeProvider(),
    fragment,
    sessionId,
    setStatus: () => undefined,
    setTail: () => undefined,
    setCursorFromAbsolute: () => undefined,
    clearCursor: () => undefined,
    destroy: async () => {
      awareness.destroy()
      ydoc.destroy()
    },
  }
}

export function readDocText(session: ServerAgentSession): string {
  const { doc } = initProseMirrorDoc(session.fragment, schema)
  return doc.textBetween(0, doc.content.size, '\n\n', '\n')
}

export function readDocJson(session: ServerAgentSession) {
  const { doc } = initProseMirrorDoc(session.fragment, schema)
  return doc.toJSON()
}

export function applyExternalInsert(session: ServerAgentSession, pos: number, text: string): void {
  const { doc, meta } = initProseMirrorDoc(session.fragment, schema)
  const state = EditorState.create({ doc, schema })
  const tr = state.tr
  tr.setMeta('addToHistory', false)
  tr.insertText(text, pos)
  session.ydoc.transact((ytr) => {
    ytr.meta.set('addToHistory', false)
    updateYFragment(session.ydoc, session.fragment, tr.doc, meta as never)
  }, { source: 'test-external' })
}

export function createEventCollector() {
  const events: Array<{ name: string; value: Record<string, unknown> }> = []
  return {
    events,
    context: {
      emitCustomEvent: (name: string, value: Record<string, unknown>) => {
        events.push({ name, value })
      },
    },
  }
}
