import { EditorState } from 'prosemirror-state'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap, setBlockType, toggleMark } from 'prosemirror-commands'
import { wrapInList } from 'prosemirror-schema-list'
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
import { createChatTargetOverlayPlugin } from './chatTargetOverlay'

export function createHumanEditorState(args: {
  yFragment: Y.XmlFragment
  awareness: Awareness
}): EditorState {
  const { doc, mapping } = initProseMirrorDoc(args.yFragment, schema)
  const bulletList = schema.nodes.bullet_list
  const orderedList = schema.nodes.ordered_list
  return EditorState.create({
    doc,
    schema,
    plugins: [
      reactKeys(),
      ySyncPlugin(args.yFragment, { mapping }),
      createChatTargetOverlayPlugin({ yFragment: args.yFragment }),
      yCursorPlugin(args.awareness, {
        cursorBuilder: (user) => {
          const u = user as { role?: string; name?: string; color?: string; status?: string }
          if (u.role === 'agent') {
            const status = u.status
            const suffix = status === 'thinking' ? ' · thinking…'
              : status === 'composing' ? ' · writing…'
              : ''
            const el = defaultCursorBuilder({
              ...u,
              name: (u.name ?? 'Electra') + suffix,
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
        'Mod-b': toggleMark(schema.marks.strong),
        'Mod-i': toggleMark(schema.marks.em),
        'Mod-`': toggleMark(schema.marks.code),
        'Mod-Alt-0': setBlockType(schema.nodes.paragraph),
        'Mod-Alt-1': setBlockType(schema.nodes.heading, { level: 1 }),
        'Mod-Alt-2': setBlockType(schema.nodes.heading, { level: 2 }),
        'Mod-Alt-3': setBlockType(schema.nodes.heading, { level: 3 }),
        'Mod-Alt-4': setBlockType(schema.nodes.heading, { level: 4 }),
        ...(bulletList ? { 'Shift-Ctrl-8': wrapInList(bulletList) } : {}),
        ...(orderedList ? { 'Shift-Ctrl-9': wrapInList(orderedList) } : {}),
        'Mod-z': undo,
        'Mod-y': redo,
        'Mod-Shift-z': redo,
      }),
      keymap(baseKeymap),
    ],
  })
}
