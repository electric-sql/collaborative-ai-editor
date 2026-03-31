import { useEffect, useState } from 'react'
import { LuPencil } from 'react-icons/lu'
import type { Awareness } from 'y-protocols/awareness'

export type PresenceEntry = {
  clientId: number
  name: string
  color: string
  role?: string
}

export function PresenceBar({
  awareness,
  localClientId,
  onClickLocal,
}: {
  awareness: Awareness
  localClientId?: number
  onClickLocal?: () => void
}) {
  const [entries, setEntries] = useState<PresenceEntry[]>([])

  useEffect(() => {
    const refresh = () => {
      const raw: PresenceEntry[] = []
      awareness.getStates().forEach((state, clientId) => {
        const user = state?.user as { name?: string; color?: string; role?: string } | undefined
        if (user?.name) {
          raw.push({
            clientId,
            name: user.name,
            color: user.color ?? '#666',
            role: user.role,
          })
        }
      })
      // Deduplicate by name — keep the local clientId's entry when
      // the same user appears multiple times (e.g. stale awareness
      // lingering after a page refresh).
      const seen = new Map<string, PresenceEntry>()
      for (const entry of raw) {
        const key = `${entry.name}:${entry.role ?? ''}`
        const existing = seen.get(key)
        if (!existing || entry.clientId === localClientId) {
          seen.set(key, entry)
        }
      }
      setEntries(Array.from(seen.values()))
    }
    refresh()
    awareness.on('update', refresh)
    return () => {
      awareness.off('update', refresh)
    }
  }, [awareness, localClientId])

  if (entries.length === 0) {
    return <div className="presence-bar" />
  }

  return (
    <div className="presence-bar">
      {entries.map((e) => {
        const isLocal = e.clientId === localClientId
        return (
          <span
            key={e.clientId}
            className={`presence-pill${isLocal ? ' presence-pill--local' : ''}`}
            style={isLocal ? { borderColor: e.color } : undefined}
            onClick={isLocal ? onClickLocal : undefined}
            role={isLocal ? 'button' : undefined}
            tabIndex={isLocal ? 0 : undefined}
            onKeyDown={
              isLocal
                ? (ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') onClickLocal?.()
                  }
                : undefined
            }
            title={isLocal ? 'Click to edit your name' : undefined}
          >
            {e.name}
            {e.role === 'agent' ? ' · AI' : ''}
            {isLocal && <LuPencil className="presence-pill__edit-icon" aria-hidden="true" />}
          </span>
        )
      })}
    </div>
  )
}
