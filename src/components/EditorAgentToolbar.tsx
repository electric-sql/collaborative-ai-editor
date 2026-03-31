import { useCallback, useRef, useState } from 'react'
import { useEditorState } from '@handlewithcare/react-prosemirror'
import * as Y from 'yjs'
import { buildAgentUserPromptTemplate } from '../lib/agent/prompts'
import type { AgentRunMode } from '../lib/agent/types'
import { encodeAnchorsForAgentRun, selectionIsSingleTextblock } from '../lib/agent/clientAnchors'

export function EditorAgentToolbar(props: {
  docKey: string
  sessionId: string
  fragment: Y.XmlFragment
}) {
  const { docKey, sessionId, fragment } = props
  const state = useEditorState()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const promptRef = useRef<HTMLInputElement>(null)

  const stop = useCallback(async () => {
    abortRef.current?.abort()
    try {
      await fetch('/api/agent/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
    } catch {
      /* ignore */
    }
  }, [sessionId])

  const run = useCallback(
    async (mode: AgentRunMode) => {
      if (!state) return
      setError(null)
      const raw = promptRef.current?.value ?? ''
      const prompt = buildAgentUserPromptTemplate(mode, raw)

      if (mode === 'rewrite') {
        if (state.selection.empty) {
          setError('Select text to rewrite.')
          return
        }
        if (!selectionIsSingleTextblock(state)) {
          setError('Rewrite is limited to a single text block.')
          return
        }
      }

      const anchors = encodeAnchorsForAgentRun(fragment, state, mode)
      abortRef.current?.abort()
      abortRef.current = new AbortController()
      setBusy(true)
      try {
        const res = await fetch('/api/agent/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            docKey,
            sessionId,
            mode,
            prompt,
            ...anchors,
          }),
          signal: abortRef.current.signal,
        })
        const json = (await res.json().catch(() => ({}))) as {
          error?: string
          cancelled?: boolean
        }
        if (!res.ok) {
          setError(json.error ?? `Request failed (${res.status})`)
          return
        }
        if (json.cancelled) {
          setError(null)
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          setError(null)
        } else {
          setError(e instanceof Error ? e.message : 'Run failed')
        }
      } finally {
        setBusy(false)
      }
    },
    [docKey, sessionId, fragment, state],
  )

  return (
    <div className="editor-agent-toolbar">
      <input
        ref={promptRef}
        className="editor-agent-prompt"
        type="text"
        placeholder="Instruction for Electra…"
        disabled={busy}
        aria-label="Agent instruction"
      />
      <div className="editor-agent-actions">
        <button type="button" disabled={busy} onClick={() => void run('continue')}>
          Continue
        </button>
        <button type="button" disabled={busy} onClick={() => void run('insert')}>
          Insert at cursor
        </button>
        <button type="button" disabled={busy} onClick={() => void run('rewrite')}>
          Rewrite selection
        </button>
        <button type="button" className="editor-agent-stop" disabled={!busy} onClick={() => void stop()}>
          Stop
        </button>
      </div>
      {error ? <p className="editor-agent-error">{error}</p> : null}
    </div>
  )
}
