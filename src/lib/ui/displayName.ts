import { useCallback, useEffect, useState } from 'react'

const DISPLAY_NAME_STORAGE_KEY = 'y-llm.display-name'
const ADJECTIVES = [
  'Curious',
  'Bright',
  'Calm',
  'Swift',
  'Mellow',
  'Clever',
  'Quiet',
  'Sunny',
]
const NOUNS = [
  'Otter',
  'Falcon',
  'Maple',
  'Comet',
  'Harbor',
  'Willow',
  'Sparrow',
  'River',
]

export function generateRandomDisplayName(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)] ?? 'Curious'
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)] ?? 'Otter'
  return `${adjective} ${noun}`
}

export function useStoredDisplayName(): {
  displayName: string
  ready: boolean
  saveDisplayName: (value: string) => string
} {
  const [displayName, setDisplayName] = useState('Guest')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const stored = window.localStorage.getItem(DISPLAY_NAME_STORAGE_KEY)?.trim()
    const next = stored && stored.length > 0 ? stored : generateRandomDisplayName()
    window.localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, next)
    setDisplayName(next)
    setReady(true)
  }, [])

  const saveDisplayName = useCallback((value: string) => {
    const next = value.trim() || generateRandomDisplayName()
    setDisplayName(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, next)
    }
    return next
  }, [])

  return { displayName, ready, saveDisplayName }
}
