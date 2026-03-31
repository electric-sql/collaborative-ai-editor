import { YjsProvider } from '@durable-streams/y-durable-streams'
import { Doc, type XmlFragment, relativePositionToJSON } from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import {
  docCollaborationDocId,
  durableStreamsYjsBaseUrl,
  getYjsDurableStreamsHeadersServer,
  getYjsDurableStreamsOriginServer,
} from '../yjs/streamIds'
import { Y_XML_FRAGMENT_KEY } from '../yjs/createRoomProvider'
import { absolutePositionToRelativePosition } from 'y-prosemirror'
import type { ProsemirrorMapping } from './relativeAnchors'
import type { AgentAwarenessStatus, AgentTransactionOrigin } from './types'

export const AGENT_DISPLAY_NAME = 'Electra'
export const AGENT_COLOR = '#7c3aed'

export function createAgentTransactionOrigin(sessionId: string): AgentTransactionOrigin {
  return { source: 'agent', sessionId }
}

export interface ServerAgentSession {
  ydoc: Doc
  awareness: Awareness
  provider: YjsProvider
  fragment: XmlFragment
  sessionId: string
  setStatus: (status: AgentAwarenessStatus) => void
  /** Ephemeral composing tail (not yet committed), shown in client overlay. */
  setTail: (tail: string | null) => void
  setCursorFromAbsolute: (absPos: number, mapping: ProsemirrorMapping) => void
  clearCursor: () => void
  destroy: () => void
}

export function createServerAgentSession(docKey: string, sessionId: string): ServerAgentSession {
  const ydoc = new Doc()
  const awareness = new Awareness(ydoc)

  const setUserFields = (status: AgentAwarenessStatus) => {
    const prev = awareness.getLocalState() ?? {}
    const prevUser = (prev.user ?? {}) as Record<string, unknown>
    awareness.setLocalState({
      ...prev,
      user: {
        ...prevUser,
        name: AGENT_DISPLAY_NAME,
        color: AGENT_COLOR,
        role: 'agent',
        status,
      },
    })
  }

  setUserFields('idle')

  const baseUrl = durableStreamsYjsBaseUrl(getYjsDurableStreamsOriginServer())
  const docId = docCollaborationDocId(docKey)
  const headers = getYjsDurableStreamsHeadersServer()

  const provider = new YjsProvider({
    doc: ydoc,
    baseUrl,
    docId,
    awareness,
    ...(headers ? { headers } : {}),
  })

  const fragment = ydoc.getXmlFragment(Y_XML_FRAGMENT_KEY)

  const setStatus = (status: AgentAwarenessStatus) => {
    setUserFields(status)
  }

  const setTail = (tail: string | null) => {
    const prev = awareness.getLocalState() ?? {}
    const prevUser = (prev.user ?? {}) as Record<string, unknown>
    const nextUser: Record<string, unknown> = {
      ...prevUser,
      name: AGENT_DISPLAY_NAME,
      color: AGENT_COLOR,
      role: 'agent',
    }
    if (tail !== null && tail.length > 0) {
      nextUser.agentTail = tail
    } else {
      delete nextUser.agentTail
    }
    awareness.setLocalState({ ...prev, user: nextUser })
  }

  const setCursorFromAbsolute = (absPos: number, mapping: ProsemirrorMapping) => {
    const rel = absolutePositionToRelativePosition(absPos, fragment, mapping as never)
    const anchor = relativePositionToJSON(rel)
    const prev = awareness.getLocalState() ?? {}
    awareness.setLocalState({
      ...prev,
      cursor: { anchor, head: anchor },
    })
  }

  const clearCursor = () => {
    const prev = awareness.getLocalState() ?? {}
    if ('cursor' in prev) {
      const { cursor: _c, ...rest } = prev
      awareness.setLocalState(rest)
    }
  }

  const destroy = () => {
    try {
      provider.destroy()
    } finally {
      awareness.destroy()
      ydoc.destroy()
    }
  }

  return {
    ydoc,
    awareness,
    provider,
    fragment,
    sessionId,
    setStatus,
    setTail,
    setCursorFromAbsolute,
    clearCursor,
    destroy,
  }
}
