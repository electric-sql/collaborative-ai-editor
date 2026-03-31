import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Button } from '@base-ui/react/button'
import { Input } from '@base-ui/react/input'
import { useStoredDisplayName } from '../lib/ui/displayName'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const navigate = Route.useNavigate()
  const [draftDoc, setDraftDoc] = useState('')
  const { displayName, saveDisplayName } = useStoredDisplayName()
  const [draftName, setDraftName] = useState(displayName)

  useEffect(() => {
    setDraftName(displayName)
  }, [displayName])

  return (
    <main className="landing-page">
      <div className="landing-stack">
        <div className="landing-card">
          <p className="landing-kicker">Electra</p>
          <h1 className="page-title">Collaborative AI Editor</h1>
          <p className="page-lead">
            Create or join a document to start writing collaboratively
            with other people and an AI assistant.
          </p>
          <form
            className="landing-form"
            onSubmit={(e) => {
              e.preventDefault()
              const next = draftDoc.trim()
              if (!next) return
              saveDisplayName(draftName)
              void navigate({
                to: '/doc/$name',
                params: { name: next },
              })
            }}
          >
            <div className="field-stack">
              <label className="field-label" htmlFor="display-name">
                Your name
              </label>
              <Input
                id="display-name"
                className="doc-picker-input doc-picker-input--landing"
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => {
                  const next = saveDisplayName(draftName)
                  setDraftName(next)
                }}
                placeholder="Choose a display name"
              />
            </div>
            <div className="field-stack">
              <label className="field-label" htmlFor="document-name">
                Document name
              </label>
              <Input
                id="document-name"
                className="doc-picker-input doc-picker-input--landing"
                type="text"
                value={draftDoc}
                onChange={(e) => setDraftDoc(e.target.value)}
                placeholder="Document name (e.g. roadmap-notes)"
                autoFocus
              />
            </div>
            <Button type="submit" className="doc-picker-button doc-picker-button--landing">
              Open document
            </Button>
          </form>
        </div>

        <div className="landing-overview">
          <p className="landing-overview__text">
            This app demos a collaborative AI writing workflow built on Durable Streams.
            The document is shared with Yjs over HTTP, while chat, tool calls, and model
            streams run through the Durable Session pattern for TanStack AI.
          </p>
          <div className="landing-links">
            <a className="landing-link" href="https://durablestreams.com" target="_blank" rel="noreferrer">
              Durable Streams
            </a>
            <a className="landing-link" href="http://electric-sql.com/" target="_blank" rel="noreferrer">
              ElectricSQL
            </a>
            <a className="landing-link" href="http://tanstack.com/ai/" target="_blank" rel="noreferrer">
              TanStack AI
            </a>
            <a className="landing-link" href="http://yjs.dev" target="_blank" rel="noreferrer">
              Yjs
            </a>
            <a className="landing-link" href="http://prosemirror.net" target="_blank" rel="noreferrer">
              ProseMirror
            </a>
          </div>
        </div>
      </div>
    </main>
  )
}
