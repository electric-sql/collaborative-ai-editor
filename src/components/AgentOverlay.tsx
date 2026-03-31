import { useEffect, useRef, useState } from 'react'
import { useEditorEffect } from '@handlewithcare/react-prosemirror'
import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { ySyncPluginKey, relativePositionToAbsolutePosition } from 'y-prosemirror'
type AgentUi = { status: string; tail: string }

function readAgentUi(awareness: Awareness): AgentUi | null {
  let out: AgentUi | null = null
  awareness.getStates().forEach((state) => {
    const user = state?.user as { role?: string; status?: string; agentTail?: string } | undefined
    if (user?.role === 'agent') {
      out = {
        status: user.status ?? 'idle',
        tail: typeof user.agentTail === 'string' ? user.agentTail : '',
      }
    }
  })
  return out
}

function findAgentCursorJson(awareness: Awareness): unknown | null {
  let anchor: unknown | null = null
  awareness.getStates().forEach((state) => {
    const user = state?.user as { role?: string } | undefined
    if (user?.role === 'agent' && state && (state as { cursor?: { anchor?: unknown } }).cursor?.anchor) {
      anchor = (state as { cursor: { anchor: unknown } }).cursor.anchor
    }
  })
  return anchor
}

export function AgentOverlay({
  awareness,
  ydoc,
}: {
  awareness: Awareness
  ydoc: Y.Doc
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [agentUi, setAgentUi] = useState<AgentUi | null>(null)

  useEffect(() => {
    const refresh = () => setAgentUi(readAgentUi(awareness))
    refresh()
    awareness.on('update', refresh)
    return () => awareness.off('update', refresh)
  }, [awareness])

  useEditorEffect(
    (view) => {
      const el = rootRef.current
      if (!el) return
      const ystate = ySyncPluginKey.getState(view.state)
      if (!ystate) {
        el.style.visibility = 'hidden'
        return
      }
      const anchorJson = findAgentCursorJson(awareness)
      if (anchorJson == null) {
        el.style.visibility = 'hidden'
        return
      }
      const rel = Y.createRelativePositionFromJSON(anchorJson)
      const pos = relativePositionToAbsolutePosition(
        ydoc,
        ystate.type,
        rel,
        ystate.binding.mapping,
      )
      if (pos === null) {
        el.style.visibility = 'hidden'
        return
      }
      const clamped = Math.min(Math.max(1, pos), view.state.doc.content.size)
      const coords = view.coordsAtPos(clamped)
      el.style.visibility = 'visible'
      el.style.left = `${coords.left}px`
      el.style.top = `${coords.bottom + 4}px`
    },
    [awareness, ydoc, agentUi?.status, agentUi?.tail],
  )

  const status = agentUi?.status ?? 'idle'
  const tail = agentUi?.tail ?? ''
  const pill =
    status === 'thinking'
      ? 'Thinking…'
      : status === 'composing'
        ? 'Composing…'
        : 'Idle'

  return (
    <div ref={rootRef} className="agent-overlay" aria-live="polite">
      <span className="agent-overlay-pill">{pill}</span>
      {tail.length > 0 ? <span className="agent-overlay-tail">{tail}</span> : null}
    </div>
  )
}
