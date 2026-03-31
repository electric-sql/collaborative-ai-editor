import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { ChatSidebar } from '../components/ChatSidebar'
import { CollaborativeEditor } from '../components/CollaborativeEditor'

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>) => ({
    doc: typeof search.doc === 'string' ? search.doc : '',
  }),
  component: Home,
})

function Home() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const [draftDoc, setDraftDoc] = useState(search.doc)

  const docKey = search.doc.trim()
  const sessionId = 'main'

  if (!docKey) {
    return (
      <main className="page">
        <h1 className="page-title">Electra Collaborative Editor</h1>
        <p className="page-lead">
          Create or join a document. The same name is used for the shared Yjs room and
          for this document&apos;s chat stream namespace.
        </p>
        <form
          className="doc-picker"
          onSubmit={(e) => {
            e.preventDefault()
            const next = draftDoc.trim()
            if (!next) return
            void navigate({ search: { doc: next } })
          }}
        >
          <input
            className="doc-picker-input"
            type="text"
            value={draftDoc}
            onChange={(e) => setDraftDoc(e.target.value)}
            placeholder="Document name (e.g. roadmap-notes)"
            autoFocus
          />
          <button type="submit" className="doc-picker-button">
            Open document
          </button>
        </form>
      </main>
    )
  }

  return (
    <main className="page">
      <h1 className="page-title">Collaborative editor</h1>
      <p className="page-lead">
        Document: <code>{docKey}</code>. Open a second tab to see live collaboration.
      </p>
      <div className="page-split">
        <div className="page-split-main">
          <CollaborativeEditor docKey={docKey} localUserName="You" />
        </div>
        <ChatSidebar docKey={docKey} sessionId={sessionId} />
      </div>
    </main>
  )
}
