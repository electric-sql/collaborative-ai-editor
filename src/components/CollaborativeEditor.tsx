import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ProseMirror,
  ProseMirrorDoc,
  useEditorEffect,
  useEditorState,
} from '@handlewithcare/react-prosemirror'
import { TextSelection } from 'prosemirror-state'
import { toggleMark, setBlockType } from 'prosemirror-commands'
import { wrapInList, liftListItem, sinkListItem } from 'prosemirror-schema-list'
import type { EditorView } from 'prosemirror-view'
import type { Awareness } from 'y-protocols/awareness'
import { initProseMirrorDoc, undo, redo } from 'y-prosemirror'
import { createHumanEditorState } from '../lib/editor/createHumanEditor'
import { setChatTargetOverlay } from '../lib/editor/chatTargetOverlay'
import { schema } from '../lib/editor/schema'
import { createRoomProvider } from '../lib/yjs/createRoomProvider'
import {
  decodeAnchor,
  decodeAnchorBase64,
  encodeAnchorBase64,
  type ProsemirrorMapping,
} from '../lib/agent/relativeAnchors'
import type { EditorContextPayload } from '../lib/agent/editorContext'

function pickColor(seed: string): string {
  const colors = ['#2c7be5', '#e07020', '#2d9d6c', '#8a4be8', '#c94079']
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (h + seed.charCodeAt(i)) % colors.length
  }
  return colors[h]!
}

export type EditorToolbarAction =
  | 'bold'
  | 'italic'
  | 'code'
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'bulletList'
  | 'orderedList'
  | 'indent'
  | 'outdent'
  | 'undo'
  | 'redo'

export type EditorController = {
  exec: (action: EditorToolbarAction) => void
  focus: () => void
}

export type EditorConnectionState = {
  status: 'disconnected' | 'connecting' | 'connected'
  synced: boolean
  collaboratorCount: number
}

export type EditorActiveState = Record<EditorToolbarAction, boolean>

function dispatchListCommand(
  view: EditorView,
  kind: 'bullet' | 'ordered',
) {
  const listNode =
    kind === 'bullet' ? schema.nodes.bullet_list : schema.nodes.ordered_list
  const listItem = schema.nodes.list_item
  if (!listNode || !listItem) return

  const lifted = liftListItem(listItem)(view.state, view.dispatch)
  if (lifted) return
  wrapInList(listNode)(view.state, view.dispatch)
}

function EditorViewBridge(props: {
  onViewChange: (view: EditorView | null) => void
}) {
  useEditorEffect((view) => {
    props.onViewChange(view)
    return () => props.onViewChange(null)
  }, [props])
  return null
}

function ChatTargetOverlaySync(props: {
  active: boolean
  editorContext: EditorContextPayload | null
}) {
  useEditorEffect((view) => {
    const timeoutId = window.setTimeout(() => {
      setChatTargetOverlay(view, {
        active: props.active,
        context: props.editorContext,
      })
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [props.active, props.editorContext])
  return null
}

function isMarkActive(state: import('prosemirror-state').EditorState, markType: import('prosemirror-model').MarkType): boolean {
  const { from, $from, to, empty } = state.selection
  if (empty) return !!markType.isInSet(state.storedMarks || $from.marks())
  return state.doc.rangeHasMark(from, to, markType)
}

function isNodeActive(state: import('prosemirror-state').EditorState, nodeType: import('prosemirror-model').NodeType): boolean {
  const { $from } = state.selection
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type === nodeType) return true
  }
  return false
}

function ActiveStateWatcher({ onChange }: { onChange: (state: EditorActiveState) => void }) {
  const editorState = useEditorState()
  const prevRef = useRef('')
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!editorState) return
    const s = editorState
    const next: EditorActiveState = {
      bold: isMarkActive(s, s.schema.marks.strong),
      italic: isMarkActive(s, s.schema.marks.em),
      code: isMarkActive(s, s.schema.marks.code),
      paragraph: s.selection.$from.parent.type === s.schema.nodes.paragraph,
      heading1:
        s.selection.$from.parent.type === s.schema.nodes.heading &&
        s.selection.$from.parent.attrs.level === 1,
      heading2:
        s.selection.$from.parent.type === s.schema.nodes.heading &&
        s.selection.$from.parent.attrs.level === 2,
      heading3:
        s.selection.$from.parent.type === s.schema.nodes.heading &&
        s.selection.$from.parent.attrs.level === 3,
      heading4:
        s.selection.$from.parent.type === s.schema.nodes.heading &&
        s.selection.$from.parent.attrs.level === 4,
      bulletList: isNodeActive(s, s.schema.nodes.bullet_list),
      orderedList: isNodeActive(s, s.schema.nodes.ordered_list),
      indent: false,
      outdent: false,
      undo: false,
      redo: false,
    }
    const key = JSON.stringify(next)
    if (key !== prevRef.current) {
      prevRef.current = key
      onChangeRef.current(next)
    }
  }, [editorState])
  return null
}

function SelectionContextWatcher(props: {
  fragment: import('yjs').XmlFragment
  enabled: boolean
  onChange: (context: EditorContextPayload | null) => void
}) {
  const editorState = useEditorState()
  const prevRef = useRef('')
  const onChangeRef = useRef(props.onChange)
  onChangeRef.current = props.onChange

  useEffect(() => {
    if (!props.enabled) return
    if (!editorState) return
    const { meta } = initProseMirrorDoc(props.fragment, schema)
    const mapping = meta.mapping as ProsemirrorMapping
    const anchor = encodeAnchorBase64(props.fragment, mapping, editorState.selection.anchor)
    const head = encodeAnchorBase64(props.fragment, mapping, editorState.selection.head)
    const next: EditorContextPayload =
      editorState.selection.empty
        ? { kind: 'cursor', anchor: head }
        : { kind: 'selection', anchor, head }
    const key = JSON.stringify(next)
    if (key !== prevRef.current) {
      prevRef.current = key
      onChangeRef.current(next)
    }
  }, [editorState, props.enabled, props.fragment])

  return null
}

function restoreSelectionFromEditorContext(
  view: EditorView,
  fragment: import('yjs').XmlFragment,
  editorContext: EditorContextPayload | null | undefined,
): void {
  if (!editorContext || !fragment.doc) return
  const { meta } = initProseMirrorDoc(fragment, schema)
  const mapping = meta.mapping as ProsemirrorMapping
  const anchor = decodeAnchor(fragment.doc, fragment, mapping, decodeAnchorBase64(editorContext.anchor))
  if (anchor === null) return

  const selection =
    editorContext.kind === 'selection'
      ? (() => {
          const head = decodeAnchor(fragment.doc, fragment, mapping, decodeAnchorBase64(editorContext.head))
          if (head === null) return null
          return TextSelection.create(view.state.doc, Math.min(anchor, head), Math.max(anchor, head))
        })()
      : TextSelection.create(view.state.doc, anchor)

  if (!selection) return
  const current = view.state.selection
  if (current.from === selection.from && current.to === selection.to) return
  const tr = view.state.tr.setSelection(selection)
  tr.setMeta('addToHistory', false)
  view.dispatch(tr)
}

function isDocumentEffectivelyEmpty(fragment: import('yjs').XmlFragment): boolean {
  const { doc } = initProseMirrorDoc(fragment, schema)
  return doc.textBetween(0, doc.content.size, '\n\n', '\n').trim().length === 0
}

function buildStartCursorContext(fragment: import('yjs').XmlFragment): EditorContextPayload {
  const { doc, meta } = initProseMirrorDoc(fragment, schema)
  const mapping = meta.mapping as ProsemirrorMapping
  return {
    kind: 'cursor',
    anchor: encodeAnchorBase64(fragment, mapping, TextSelection.atStart(doc).from),
  }
}

export function CollaborativeEditor(props: {
  docKey: string
  localUserName: string
  onControllerChange?: (controller: EditorController | null) => void
  onConnectionStateChange?: (state: EditorConnectionState) => void
  onAwarenessChange?: (awareness: Awareness | null, localClientId: number) => void
  onActiveStateChange?: (state: EditorActiveState) => void
  onEditorContextChange?: (context: EditorContextPayload | null) => void
  showChatTargetOverlay?: boolean
  chatTargetContext?: EditorContextPayload | null
  freezeEditorContext?: boolean
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) {
    return <p className="status-line">Loading editor…</p>
  }

  return <CollaborativeEditorInner {...props} />
}

function CollaborativeEditorInner({
  docKey,
  localUserName,
  onControllerChange,
  onConnectionStateChange,
  onAwarenessChange,
  onActiveStateChange,
  onEditorContextChange,
  showChatTargetOverlay,
  chatTargetContext,
  freezeEditorContext,
}: {
  docKey: string
  localUserName: string
  onControllerChange?: (controller: EditorController | null) => void
  onConnectionStateChange?: (state: EditorConnectionState) => void
  onAwarenessChange?: (awareness: Awareness | null, localClientId: number) => void
  onActiveStateChange?: (state: EditorActiveState) => void
  onEditorContextChange?: (context: EditorContextPayload | null) => void
  showChatTargetOverlay?: boolean
  chatTargetContext?: EditorContextPayload | null
  freezeEditorContext?: boolean
}) {
  const [room, setRoom] = useState<ReturnType<typeof createRoomProvider> | null>(null)
  const [editorView, setEditorView] = useState<EditorView | null>(null)
  const [selectionTrackingEnabled, setSelectionTrackingEnabled] = useState(
    freezeEditorContext !== true,
  )
  const viewRef = useRef<EditorView | null>(null)
  const targetContextRef = useRef<EditorContextPayload | null>(chatTargetContext ?? null)
  const prevFreezeRef = useRef<boolean>(Boolean(freezeEditorContext))
  const pendingSelectionRestoreRef = useRef(false)
  const pendingBootstrapCursorRef = useRef(false)

  useEffect(() => {
    targetContextRef.current = chatTargetContext ?? null
  }, [chatTargetContext])

  useEffect(() => {
    const nextRoom = createRoomProvider({
      docKey,
      localUserName,
      localUserColor: pickColor(`${docKey}:${localUserName}`),
    })
    setRoom(nextRoom)
    return () => {
      nextRoom.provider.destroy()
      nextRoom.awareness.destroy()
      nextRoom.ydoc.destroy()
      setRoom(null)
    }
  }, [docKey, localUserName])

  useEffect(() => {
    if (room) {
      onAwarenessChange?.(room.awareness, room.awareness.clientID)
    } else {
      onAwarenessChange?.(null, 0)
    }
  }, [room, onAwarenessChange])

  useEffect(() => {
    if (!room) {
      onEditorContextChange?.(null)
    }
  }, [room, onEditorContextChange])

  useEffect(() => {
    if (freezeEditorContext) {
      pendingSelectionRestoreRef.current = true
      pendingBootstrapCursorRef.current =
        chatTargetContext?.kind === 'cursor' && !!room && isDocumentEffectivelyEmpty(room.fragment)
      setSelectionTrackingEnabled(false)
      prevFreezeRef.current = true
      return
    }

    pendingBootstrapCursorRef.current = false

    if (!room || !editorView) {
      setSelectionTrackingEnabled(true)
      prevFreezeRef.current = Boolean(freezeEditorContext)
      return
    }
    const wasFrozen = prevFreezeRef.current
    prevFreezeRef.current = false
    if (wasFrozen) {
      setSelectionTrackingEnabled(false)
      return
    }
    setSelectionTrackingEnabled(true)
  }, [chatTargetContext, freezeEditorContext, room])

  useEffect(() => {
    if (!room || !freezeEditorContext || !pendingBootstrapCursorRef.current || !onEditorContextChange) {
      return
    }

    const handleAfterTransaction = () => {
      if (!pendingBootstrapCursorRef.current) return
      if (isDocumentEffectivelyEmpty(room.fragment)) return
      pendingBootstrapCursorRef.current = false
      const nextContext = buildStartCursorContext(room.fragment)
      targetContextRef.current = nextContext
      onEditorContextChange(nextContext)
      pendingSelectionRestoreRef.current = false
      window.setTimeout(() => {
        if (viewRef.current) {
          restoreSelectionFromEditorContext(viewRef.current, room.fragment, nextContext)
        }
      }, 0)
    }

    room.ydoc.on('afterTransaction', handleAfterTransaction)
    return () => {
      room.ydoc.off('afterTransaction', handleAfterTransaction)
    }
  }, [freezeEditorContext, onEditorContextChange, room])

  useEffect(() => {
    if (!room || !editorView) return

    const handleFocus = () => {
      if (pendingSelectionRestoreRef.current) {
        pendingSelectionRestoreRef.current = false
        window.setTimeout(() => {
          restoreSelectionFromEditorContext(editorView, room.fragment, targetContextRef.current)
          setSelectionTrackingEnabled(true)
        }, 0)
        return
      }
      if (!freezeEditorContext) {
        setSelectionTrackingEnabled(true)
      }
    }

    editorView.dom.addEventListener('focus', handleFocus)
    return () => {
      editorView.dom.removeEventListener('focus', handleFocus)
    }
  }, [chatTargetContext, editorView, freezeEditorContext, room])

  useEffect(() => {
    if (!room || !onConnectionStateChange) return

    const emit = () => {
      const states = room.awareness.getStates()
      onConnectionStateChange({
        status: room.provider.connected
          ? 'connected'
          : room.provider.connecting
            ? 'connecting'
            : 'disconnected',
        synced: room.provider.synced,
        collaboratorCount: states.size,
      })
    }

    const handleStatus = () => emit()
    const handleSynced = () => emit()
    const handleAwareness = () => emit()

    room.provider.on('status', handleStatus)
    room.provider.on('synced', handleSynced)
    room.awareness.on('change', handleAwareness)
    emit()

    return () => {
      room.provider.off('status', handleStatus)
      room.provider.off('synced', handleSynced)
      room.awareness.off('change', handleAwareness)
    }
  }, [onConnectionStateChange, room])

  const defaultState = useMemo(
    () =>
      room
        ? createHumanEditorState({
            yFragment: room.fragment,
            awareness: room.awareness,
          })
        : null,
    [room],
  )

  const controller = useMemo<EditorController>(
    () => ({
      exec(action) {
        const view = viewRef.current
        if (!view) return

        const { state } = view
        const dispatch = view.dispatch.bind(view)

        switch (action) {
          case 'bold':
            toggleMark(state.schema.marks.strong)(state, dispatch, view)
            break
          case 'italic':
            toggleMark(state.schema.marks.em)(state, dispatch, view)
            break
          case 'code':
            toggleMark(state.schema.marks.code)(state, dispatch, view)
            break
          case 'paragraph':
            setBlockType(state.schema.nodes.paragraph)(state, dispatch, view)
            break
          case 'heading1':
          case 'heading2':
          case 'heading3':
          case 'heading4': {
            const level =
              action === 'heading1' ? 1 : action === 'heading2' ? 2 : action === 'heading3' ? 3 : 4
            setBlockType(state.schema.nodes.heading, { level })(state, dispatch, view)
            break
          }
          case 'bulletList':
            dispatchListCommand(view, 'bullet')
            break
          case 'orderedList':
            dispatchListCommand(view, 'ordered')
            break
          case 'indent':
            if (schema.nodes.list_item) {
              sinkListItem(schema.nodes.list_item)(state, dispatch)
            }
            break
          case 'outdent':
            if (schema.nodes.list_item) {
              liftListItem(schema.nodes.list_item)(state, dispatch)
            }
            break
          case 'undo':
            undo(state)
            break
          case 'redo':
            redo(state)
            break
        }

        view.focus()
      },
      focus() {
        viewRef.current?.focus()
      },
    }),
    [],
  )

  useEffect(() => {
    onControllerChange?.(controller)
    return () => onControllerChange?.(null)
  }, [controller, onControllerChange])

  if (!room) {
    return <p className="status-line">Connecting collaborative room…</p>
  }

  return (
    <div className="editor-wrap">
      <ProseMirror key={docKey} defaultState={defaultState!}>
        <EditorViewBridge
          onViewChange={(view) => {
            viewRef.current = view
            setEditorView(view)
          }}
        />
        <ChatTargetOverlaySync
          active={showChatTargetOverlay === true && !!chatTargetContext}
          editorContext={chatTargetContext ?? null}
        />
        {onActiveStateChange && <ActiveStateWatcher onChange={onActiveStateChange} />}
        {onEditorContextChange && (
          <SelectionContextWatcher
            fragment={room.fragment}
            enabled={selectionTrackingEnabled}
            onChange={onEditorContextChange}
          />
        )}
        <div className="editor-surface-wrap">
          <ProseMirrorDoc className="editor-surface" />
        </div>
      </ProseMirror>
    </div>
  )
}
