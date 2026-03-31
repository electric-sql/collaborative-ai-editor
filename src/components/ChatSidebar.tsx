import { useEffect, useMemo, useState } from 'react'
import { useChat } from '@tanstack/ai-react'
import type { UIMessage } from '@tanstack/ai'
import { createDurableChatConnection } from '../lib/chat/createDurableChatConnection'

function textFromMessage(m: UIMessage): string {
  if (!Array.isArray(m.parts)) return ''
  return m.parts
    .filter((p) => p.type === 'text')
    .map((p) =>
      'content' in p && typeof p.content === 'string'
        ? p.content
        : 'text' in p && typeof p.text === 'string'
          ? p.text
          : '',
    )
    .join('')
}

export function ChatSidebar(props: { docKey: string; sessionId?: string }) {
  const { docKey, sessionId = 'default' } = props
  const [mounted, setMounted] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => setMounted(true), [])

  const chatId = useMemo(
    () => `${docKey}:${sessionId}`,
    [docKey, sessionId],
  )
  const connection = useMemo(
    () =>
      createDurableChatConnection({
        docKey,
        sessionId,
      }),
    [docKey, sessionId],
  )

  const { messages, sendMessage, stop, isLoading, sessionGenerating, error } = useChat({
    id: chatId,
    connection,
    live: true,
  })

  const busy = isLoading || sessionGenerating

  if (!mounted) {
    return (
      <aside className="chat-sidebar">
        <p className="chat-status">Loading chat…</p>
      </aside>
    )
  }

  return (
    <aside className="chat-sidebar">
      <h2 className="chat-heading">Chat</h2>
      <p className="chat-meta">
        doc: <code>{docKey}</code> · session: <code>{sessionId}</code>
      </p>
      <div className="chat-messages" aria-live="polite">
        {messages.length === 0 ? (
          <p className="chat-empty">No messages yet. Send a message to begin.</p>
        ) : (
          <ul className="chat-list">
            {messages.map((m) => (
              <li key={m.id} className={`chat-msg chat-msg-${m.role}`}>
                <span className="chat-role">{m.role}</span>
                <div className="chat-text">{textFromMessage(m) || '…'}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error ? <p className="chat-error">{error.message}</p> : null}
      <div className="chat-input-row">
        <input
          className="chat-input"
          type="text"
          value={draft}
          placeholder="Message…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              const text = draft.trim()
              if (!text || busy) return
              void sendMessage(text)
              setDraft('')
            }
          }}
          disabled={busy}
        />
        <button
          type="button"
          className="chat-send"
          onClick={() => {
            const text = draft.trim()
            if (!text || busy) return
            void sendMessage(text)
            setDraft('')
          }}
          disabled={busy}
        >
          Send
        </button>
        <button
          type="button"
          className="chat-send"
          onClick={() => {
            stop()
            void fetch('/api/agent/stop', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId }),
            }).catch(() => {})
          }}
          disabled={!busy}
        >
          Stop
        </button>
      </div>
      <p className="chat-status">
        {busy ? 'Running Electra…' : 'Connected via durable stream'}
      </p>
    </aside>
  )
}
