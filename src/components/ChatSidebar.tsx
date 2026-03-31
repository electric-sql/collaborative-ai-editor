import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@tanstack/ai-react'
import type { UIMessage } from '@tanstack/ai'
import { Button } from '@base-ui/react/button'
import { createDurableChatConnection } from '../lib/chat/createDurableChatConnection'

export type ChatSidebarStatus = {
  connectionStatus: string
  subscribed: boolean
  busy: boolean
}

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

export function ChatSidebar(props: {
  docKey: string
  sessionId?: string
  displayName?: string
  onStatusChange?: (status: ChatSidebarStatus) => void
}) {
  const { docKey, sessionId = 'default' } = props
  const [mounted, setMounted] = useState(false)
  const [draft, setDraft] = useState('')
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

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

  const {
    messages,
    sendMessage,
    stop,
    isLoading,
    sessionGenerating,
    error,
    connectionStatus,
    isSubscribed,
  } = useChat({
    id: chatId,
    connection,
    live: true,
  })

  const busy = isLoading || sessionGenerating

  useEffect(() => {
    props.onStatusChange?.({
      connectionStatus,
      subscribed: isSubscribed,
      busy,
    })
  }, [busy, connectionStatus, isSubscribed, props.onStatusChange])

  const stuckToBottom = useRef(true)

  const handleScroll = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stuckToBottom.current = distanceFromBottom <= 30
  }, [])

  useEffect(() => {
    const el = viewportRef.current
    if (!el || !stuckToBottom.current) return
    el.scrollTop = el.scrollHeight
  }, [messages, busy])

  useEffect(() => {
    if (!stuckToBottom.current) return
    const el = viewportRef.current
    if (!el) return
    const observer = new MutationObserver(() => {
      if (stuckToBottom.current && el) {
        el.scrollTop = el.scrollHeight
      }
    })
    observer.observe(el, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [messages.length])

  // Auto-grow textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }, [draft])

  const handleSend = () => {
    const text = draft.trim()
    if (!text || busy) return
    void sendMessage(text)
    setDraft('')
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  if (!mounted) {
    return (
      <aside className="chat-sidebar">
        <p className="chat-loading">Loading chat…</p>
      </aside>
    )
  }

  return (
    <aside className="chat-sidebar">
      <h2 className="chat-heading">Chat</h2>
      <div ref={viewportRef} className="chat-messages" aria-live="polite" onScroll={handleScroll}>
        {messages.length === 0 ? (
          <p className="chat-empty">No messages yet. Send a message to begin.</p>
        ) : (
          <ul className="chat-list">
            {messages.map((m) => (
              <li key={m.id} className={`chat-msg chat-msg-${m.role}`}>
                <span className="chat-role">
                  {m.role === 'user' && props.displayName ? props.displayName : m.role}
                </span>
                <div className="chat-text">{textFromMessage(m) || '…'}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error ? <p className="chat-error">{error.message}</p> : null}
      {busy && (
        <div className="chat-stop-bar">
          <Button
            className="chat-stop-btn"
            onClick={() => {
              stop()
              void fetch('/api/agent/stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId }),
              }).catch(() => {})
            }}
          >
            Stop generating
          </Button>
        </div>
      )}
      <div className="chat-input-wrap">
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={draft}
          placeholder="Message…"
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          disabled={busy}
        />
        <Button
          className="chat-send-inline"
          onClick={handleSend}
          disabled={busy || !draft.trim()}
        >
          Send
        </Button>
      </div>
    </aside>
  )
}
