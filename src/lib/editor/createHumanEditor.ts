import { EditorState } from 'prosemirror-state'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap } from 'prosemirror-commands'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { reactKeys } from '@handlewithcare/react-prosemirror'
import {
  ySyncPlugin,
  yCursorPlugin,
  yUndoPlugin,
  defaultCursorBuilder,
  defaultSelectionBuilder,
  undo,
  redo,
  initProseMirrorDoc,
} from 'y-prosemirror'
import { schema } from './schema'

export function createHumanEditorState(args: {
  yFragment: Y.XmlFragment
  awareness: Awareness
}): EditorState {
  const { doc, mapping } = initProseMirrorDoc(args.yFragment, schema)
  return EditorState.create({
    doc,
    schema,
    plugins: [
      reactKeys(),
      ySyncPlugin(args.yFragment, { mapping }),
      yCursorPlugin(args.awareness, {
        cursorBuilder: (user) => {
          const u = user as { role?: string; name?: string; color?: string }
          if (u.role === 'agent') {
            const el = defaultCursorBuilder({
              ...u,
              name: u.name ?? 'Electra',
            })
            el.classList.add('ProseMirror-yjs-cursor--agent')
            return el
          }
          return defaultCursorBuilder(user)
        },
        selectionBuilder: (user) => {
          const u = user as { role?: string }
          const base = defaultSelectionBuilder(user)
          if (u.role === 'agent') {
            return {
              ...base,
              class: `${base.class ?? ''} ProseMirror-yjs-selection--agent`.trim(),
            }
          }
          return base
        },
      }),
      yUndoPlugin(),
      keymap({
        'Mod-z': undo,
        'Mod-y': redo,
        'Mod-Shift-z': redo,
      }),
      keymap(baseKeymap),
    ],
  })
}
