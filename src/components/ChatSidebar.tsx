import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@tanstack/ai-react'
import type { StreamChunk, UIMessage } from '@tanstack/ai'
import { Button } from '@base-ui/react/button'
import { createDurableChatConnection } from '../lib/chat/createDurableChatConnection'

export type ChatSidebarStatus = {
  connectionStatus: string
  subscribed: boolean
  busy: boolean
}

type DocInsertMessage = {
  id: string
  startedAt: number
  updatedAt: number
  mode?: string
  contentFormat?: string
  content: string
  complete: boolean
  cancelled?: boolean
  committedChars?: number
}

type RenderItem =
  | {
      kind: 'message'
      key: string
      order: number
      time: number
      message: UIMessage
      variant: 'full' | 'meta' | 'text'
    }
  | {
      kind: 'insertion'
      key: string
      order: number
      time: number
      insertion: DocInsertMessage
    }

function previewText(text: string, maxChars: number = 96): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}…`
}

function stringifyData(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function messageTimestamp(message: UIMessage, fallback: number): number {
  if (message.createdAt instanceof Date) return message.createdAt.getTime()
  if (message.createdAt) return new Date(message.createdAt as unknown as string).getTime()
  return fallback
}

function filterMessageParts(message: UIMessage, predicate: (part: UIMessage['parts'][number]) => boolean): UIMessage {
  return {
    ...message,
    parts: Array.isArray(message.parts) ? message.parts.filter(predicate) : [],
  }
}

function isTextPart(part: UIMessage['parts'][number]): boolean {
  return part.type === 'text'
}

function hasStartStreamingEditTool(message: UIMessage): boolean {
  return (
    Array.isArray(message.parts) &&
    message.parts.some(
      (part) => part.type === 'tool-call' && 'name' in part && part.name === 'start_streaming_edit',
    )
  )
}

function hasVisibleAssistantText(message: UIMessage): boolean {
  return (
    Array.isArray(message.parts) &&
    message.parts.some(
      (part) =>
        part.type === 'text' &&
        (('content' in part && typeof part.content === 'string' && part.content.trim().length > 0) ||
          ('text' in part && typeof part.text === 'string' && part.text.trim().length > 0)),
    )
  )
}

function MessagePartView({ message }: { message: UIMessage }) {
  if (!Array.isArray(message.parts) || message.parts.length === 0) {
    return <div className="chat-text">…</div>
  }

  return (
    <div className="chat-part-list">
      {message.parts.map((part, index) => {
        if (part.type === 'text') {
          const content =
            'content' in part && typeof part.content === 'string'
              ? part.content
              : 'text' in part && typeof part.text === 'string'
                ? part.text
                : ''
          return (
            <div key={`${message.id}-text-${index}`} className="chat-text">
              {content || '…'}
            </div>
          )
        }

        if (part.type === 'thinking') {
          return (
            <details key={`${message.id}-thinking-${index}`} className="chat-disclosure">
              <summary className="chat-disclosure__summary">
                <span className="chat-disclosure__icon">+</span>
                <span>Thinking</span>
              </summary>
              <pre className="chat-disclosure__body">{part.content}</pre>
            </details>
          )
        }

        if (part.type === 'tool-call') {
          return (
            <details key={`${message.id}-tool-${part.id}`} className="chat-disclosure">
              <summary className="chat-disclosure__summary">
                <span className="chat-disclosure__icon">+</span>
                <span>{`Tool · ${part.name}`}</span>
                <span className="chat-disclosure__meta">{part.state}</span>
              </summary>
              <div className="chat-disclosure__body">
                <pre>{part.arguments || '{}'}</pre>
                {typeof part.output !== 'undefined' ? <pre>{stringifyData(part.output)}</pre> : null}
              </div>
            </details>
          )
        }

        if (part.type === 'tool-result') {
          return (
            <details key={`${message.id}-tool-result-${index}`} className="chat-disclosure">
              <summary className="chat-disclosure__summary">
                <span className="chat-disclosure__icon">+</span>
                <span>Tool result</span>
                <span className="chat-disclosure__meta">{part.state}</span>
              </summary>
              <pre className="chat-disclosure__body">{part.content}</pre>
            </details>
          )
        }

        return (
          <details key={`${message.id}-part-${index}`} className="chat-disclosure">
            <summary className="chat-disclosure__summary">
              <span className="chat-disclosure__icon">+</span>
              <span>{part.type}</span>
            </summary>
            <pre className="chat-disclosure__body">{stringifyData(part)}</pre>
          </details>
        )
      })}
    </div>
  )
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
  const [docInsertions, setDocInsertions] = useState<DocInsertMessage[]>([])
  const [showTools, setShowTools] = useState(false)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => setMounted(true), [])
  useEffect(() => setDocInsertions([]), [docKey, sessionId])

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
    onChunk: (chunk: StreamChunk) => {
      if (chunk.type !== 'CUSTOM') return
      const value =
        chunk.value && typeof chunk.value === 'object'
          ? (chunk.value as Record<string, unknown>)
          : undefined
      const messageId = typeof value?.messageId === 'string' ? value.messageId : null
      if (!messageId) return

      setDocInsertions((current) => {
        const idx = current.findIndex((entry) => entry.id === messageId)
        const existing = idx >= 0 ? current[idx]! : null
        const next = [...current]

        if (chunk.name === 'streaming-insert-start') {
          const item: DocInsertMessage = {
            id: messageId,
            startedAt: chunk.timestamp,
            updatedAt: chunk.timestamp,
            mode: typeof value?.mode === 'string' ? value.mode : undefined,
            contentFormat: typeof value?.contentFormat === 'string' ? value.contentFormat : undefined,
            content: existing?.content ?? '',
            complete: false,
          }
          if (idx >= 0) next[idx] = item
          else next.push(item)
          return next
        }

        if (!existing) return current

        if (chunk.name === 'streaming-insert-delta') {
          next[idx] = {
            ...existing,
            updatedAt: chunk.timestamp,
            content:
              existing.content + (typeof value?.delta === 'string' ? value.delta : ''),
          }
          return next
        }

        if (chunk.name === 'streaming-insert-end') {
          next[idx] = {
            ...existing,
            updatedAt: chunk.timestamp,
            complete: true,
            cancelled: value?.cancelled === true,
            committedChars:
              typeof value?.committedChars === 'number' ? value.committedChars : existing.committedChars,
          }
          return next
        }

        return current
      })
    },
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
  }, [messages, docInsertions, busy])

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
  }, [messages.length, docInsertions.length])

  const renderItems = useMemo(() => {
    const items: RenderItem[] = []
    let order = 0
    let insertionCursor = 0

    messages.forEach((message, index) => {
      const time = messageTimestamp(message, index)
      const textOnlyMessage = filterMessageParts(message, isTextPart)
      const metaOnlyMessage = filterMessageParts(message, (part) => !isTextPart(part))
      const hasVisibleText = hasVisibleAssistantText(textOnlyMessage)
      const hasMeta = Array.isArray(metaOnlyMessage.parts) && metaOnlyMessage.parts.length > 0

      if (message.role === 'assistant' && hasMeta && hasVisibleText) {
        if (showTools) {
          items.push({
            kind: 'message',
            key: `msg-${message.id}-meta`,
            order: order++,
            time,
            message: metaOnlyMessage,
            variant: 'meta',
          })
        }

        let textTime = time
        if (hasStartStreamingEditTool(message) && insertionCursor < docInsertions.length) {
          const relatedInsertion = docInsertions[insertionCursor]
          if (relatedInsertion) {
            textTime = Math.max(textTime, relatedInsertion.updatedAt + 1)
            insertionCursor += 1
          }
        }

        items.push({
          kind: 'message',
          key: `msg-${message.id}-text`,
          order: order++,
          time: textTime,
          message: textOnlyMessage,
          variant: 'text',
        })
        return
      }

      if (message.role === 'assistant' && !showTools && !hasVisibleText) {
        return
      }

      items.push({
        kind: 'message',
        key: `msg-${message.id}`,
        order: order++,
        time,
        message: showTools ? message : textOnlyMessage,
        variant: 'full',
      })
    })

    if (showTools) {
      docInsertions.forEach((insertion) => {
        items.push({
          kind: 'insertion',
          key: `insert-${insertion.id}`,
          order: order++,
          time: insertion.complete ? insertion.updatedAt : insertion.startedAt,
          insertion,
        })
      })
    }

    return items.sort((a, b) =>
      a.time === b.time ? a.order - b.order : a.time - b.time,
    )
  }, [docInsertions, messages, showTools])

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
      textareaRef.current.focus()
    }
  }

  const handleStop = () => {
    stop()
    void fetch('/api/agent/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    }).catch(() => {})
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
      <div className="chat-header">
        <h2 className="chat-heading">Chat</h2>
        <label className="chat-tools-toggle">
          <input
            type="checkbox"
            checked={showTools}
            onChange={(event) => setShowTools(event.target.checked)}
          />
          <span>Show tools</span>
        </label>
      </div>
      <div ref={viewportRef} className="chat-messages" aria-live="polite" onScroll={handleScroll}>
        {renderItems.length === 0 ? (
          <p className="chat-empty">No messages yet. Send a message to begin.</p>
        ) : (
          <ul className="chat-list">
            {renderItems.map((item) =>
              item.kind === 'message' ? (
                <li
                  key={item.key}
                  className={`chat-msg chat-msg-${item.message.role}${
                    item.message.role === 'assistant' &&
                    (item.variant === 'meta' || !hasVisibleAssistantText(item.message))
                      ? ' chat-msg-assistant-meta'
                      : ''
                  }`}
                >
                  <span className="chat-role">
                    {item.message.role === 'user' && props.displayName
                      ? props.displayName
                      : item.message.role === 'assistant'
                        ? 'Electra'
                        : item.message.role}
                  </span>
                  <MessagePartView message={item.message} />
                </li>
              ) : (
                <li key={item.key} className="chat-msg chat-msg-assistant chat-msg-assistant-meta">
                  <span className="chat-role">Electra</span>
                  <details className="chat-disclosure chat-insert">
                    <summary className="chat-disclosure__summary">
                      <span className="chat-disclosure__icon">+</span>
                      <span>Streaming insertion</span>
                      <span className="chat-disclosure__meta">
                        {item.insertion.contentFormat ?? 'plain_text'}
                        {item.insertion.mode ? ` · ${item.insertion.mode}` : ''}
                        {item.insertion.complete ? ' · complete' : ' · streaming'}
                      </span>
                    </summary>
                    <div className="chat-insert__preview">{previewText(item.insertion.content) || '…'}</div>
                    <div className="chat-disclosure__body">
                      <pre>{item.insertion.content || '…'}</pre>
                      <pre>
                        {stringifyData({
                          mode: item.insertion.mode,
                          contentFormat: item.insertion.contentFormat,
                          committedChars: item.insertion.committedChars,
                          cancelled: item.insertion.cancelled ?? false,
                        })}
                      </pre>
                    </div>
                  </details>
                </li>
              ),
            )}
          </ul>
        )}
        {busy ? (
          <div className="chat-typing-row" aria-label="Generating response">
            <div className="chat-typing">
              <span className="chat-typing__dot" />
              <span className="chat-typing__dot" />
              <span className="chat-typing__dot" />
            </div>
            <Button className="chat-stop-btn chat-stop-btn-inline" onClick={handleStop} aria-label="Stop generating">
              Stop
            </Button>
          </div>
        ) : null}
      </div>
      {error ? <p className="chat-error">{error.message}</p> : null}
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
