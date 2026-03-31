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
      <div className="landing-card">
        <p className="landing-kicker">Electra</p>
        <h1 className="page-title">Collaborative editor</h1>
        <p className="page-lead">
          Create or join a document. The same name is used for the shared Yjs room and
          the durable chat session.
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
            <div className="doc-picker">
              <Input
                id="document-name"
                className="doc-picker-input doc-picker-input--landing"
                type="text"
                value={draftDoc}
                onChange={(e) => setDraftDoc(e.target.value)}
                placeholder="Document name (e.g. roadmap-notes)"
                autoFocus
              />
              <Button type="submit" className="doc-picker-button">
                Open document
              </Button>
            </div>
          </div>
        </form>
      </div>
    </main>
  )
}
