import { useEffect, useState } from 'react'
import type { Awareness } from 'y-protocols/awareness'

type PresenceEntry = { clientId: number; name: string; color: string; role?: string }

export function PresenceBar({ awareness }: { awareness: Awareness }) {
  const [entries, setEntries] = useState<PresenceEntry[]>([])

  useEffect(() => {
    const refresh = () => {
      const next: PresenceEntry[] = []
      awareness.getStates().forEach((state, clientId) => {
        const user = state?.user as { name?: string; color?: string; role?: string } | undefined
        if (user?.name) {
          next.push({
            clientId,
            name: user.name,
            color: user.color ?? '#666',
            role: user.role,
          })
        }
      })
      setEntries(next)
    }
    refresh()
    awareness.on('update', refresh)
    return () => {
      awareness.off('update', refresh)
    }
  }, [awareness])

  if (entries.length === 0) {
    return <div className="presence-bar" />
  }

  return (
    <div className="presence-bar">
      {entries.map((e) => (
        <span
          key={e.clientId}
          className="presence-pill"
          style={{ borderColor: e.color }}
        >
          {e.name}
          {e.role === 'agent' ? ' · AI' : ''}
        </span>
      ))}
    </div>
  )
}
