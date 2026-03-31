import { useEffect, useMemo, useState } from 'react'
import { ProseMirror, ProseMirrorDoc } from '@handlewithcare/react-prosemirror'
import type { YjsProvider } from '@durable-streams/y-durable-streams'
import { createHumanEditorState } from '../lib/editor/createHumanEditor'
import { createRoomProvider } from '../lib/yjs/createRoomProvider'
import {
  docCollaborationDocId,
  durableStreamsYjsBaseUrl,
  getDurableStreamsOrigin,
} from '../lib/yjs/streamIds'
import { PresenceBar } from './PresenceBar'
import { AgentOverlay } from './AgentOverlay'

function pickColor(seed: string): string {
  const colors = ['#2c7be5', '#e07020', '#2d9d6c', '#8a4be8', '#c94079']
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (h + seed.charCodeAt(i)) % colors.length
  }
  return colors[h]!
}

function ProviderStatus({
  provider,
  docKey,
}: {
  provider: YjsProvider
  docKey: string
}) {
  const [synced, setSynced] = useState(provider.synced)
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>(
    provider.connected ? 'connected' : 'connecting',
  )
  const target = useMemo(() => {
    const baseUrl = durableStreamsYjsBaseUrl(getDurableStreamsOrigin())
    const docId = docCollaborationDocId(docKey)
    return `${baseUrl}/docs/${docId}`
  }, [docKey])

  useEffect(() => {
    const onSynced = (s: boolean) => setSynced(s)
    const onStatus = (s: 'disconnected' | 'connecting' | 'connected') =>
      setStatus(s)
    provider.on('synced', onSynced)
    provider.on('status', onStatus)
    return () => {
      provider.off('synced', onSynced)
      provider.off('status', onStatus)
    }
  }, [provider])

  return (
    <div className="status-line" title={target}>
      Durable Streams Yjs: {status} — synced: {synced ? 'yes' : 'no'}
    </div>
  )
}

export function CollaborativeEditor(props: {
  docKey: string
  localUserName: string
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
}: {
  docKey: string
  localUserName: string
}) {
  const [room, setRoom] = useState<ReturnType<typeof createRoomProvider> | null>(null)

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

  if (!room) {
    return <p className="status-line">Connecting collaborative room…</p>
  }

  return (
    <div className="editor-wrap">
      <PresenceBar awareness={room.awareness} />
      <ProseMirror key={docKey} defaultState={defaultState!}>
        <div className="editor-surface-wrap">
          <ProseMirrorDoc className="editor-surface" />
          <AgentOverlay awareness={room.awareness} ydoc={room.ydoc} />
        </div>
      </ProseMirror>
      <ProviderStatus provider={room.provider} docKey={docKey} />
    </div>
  )
}
