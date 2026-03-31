import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Toolbar } from '@base-ui/react/toolbar'
import { Button } from '@base-ui/react/button'
import { Input } from '@base-ui/react/input'
import { Separator } from '@base-ui/react/separator'
import type { Awareness } from 'y-protocols/awareness'
import {
  LuBold,
  LuChevronRight,
  LuFileText,
  LuHeading2,
  LuIndentDecrease,
  LuIndentIncrease,
  LuItalic,
  LuList,
  LuListOrdered,
  LuMessageSquare,
  LuRedo2,
  LuUndo2,
  LuX,
} from 'react-icons/lu'
import { ChatSidebar, type ChatSidebarStatus } from '../../components/ChatSidebar'
import {
  CollaborativeEditor,
  type EditorActiveState,
  type EditorConnectionState,
  type EditorController,
  type EditorToolbarAction,
} from '../../components/CollaborativeEditor'
import { PresenceBar } from '../../components/PresenceBar'
import { useStoredDisplayName } from '../../lib/ui/displayName'

export const Route = createFileRoute('/doc/$name')({
  component: DocumentPage,
})

const TOOLBAR_GROUPS: Array<
  Array<{ action: EditorToolbarAction; label: string; icon: typeof LuBold }>
> = [
  [
    { action: 'bold', label: 'Bold', icon: LuBold },
    { action: 'italic', label: 'Italic', icon: LuItalic },
  ],
  [{ action: 'heading', label: 'Heading', icon: LuHeading2 }],
  [
    { action: 'bulletList', label: 'Bullet list', icon: LuList },
    { action: 'orderedList', label: 'Ordered list', icon: LuListOrdered },
    { action: 'outdent', label: 'Outdent', icon: LuIndentDecrease },
    { action: 'indent', label: 'Indent', icon: LuIndentIncrease },
  ],
  [
    { action: 'undo', label: 'Undo', icon: LuUndo2 },
    { action: 'redo', label: 'Redo', icon: LuRedo2 },
  ],
]

function DocumentPage() {
  const { name } = Route.useParams()
  const navigate = Route.useNavigate()
  const docKey = name.trim()
  const sessionId = 'main'
  const { displayName, saveDisplayName, ready } = useStoredDisplayName()
  const [draftName, setDraftName] = useState(displayName)
  const [nameModalOpen, setNameModalOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const title = useMemo(() => docKey.replace(/[-_]+/g, ' '), [docKey])

  const [awareness, setAwareness] = useState<Awareness | null>(null)
  const [localClientId, setLocalClientId] = useState(0)

  const [editorController, setEditorController] = useState<EditorController | null>(null)
  const [activeState, setActiveState] = useState<EditorActiveState | null>(null)
  const [editorState, setEditorState] = useState<EditorConnectionState>({
    status: 'connecting',
    synced: false,
    collaboratorCount: 0,
  })
  const [chatState, setChatState] = useState<ChatSidebarStatus>({
    connectionStatus: 'disconnected',
    subscribed: false,
    busy: false,
  })

  useEffect(() => {
    setDraftName(displayName)
  }, [displayName])

  useEffect(() => {
    if (nameModalOpen) {
      setTimeout(() => nameInputRef.current?.select(), 30)
    }
  }, [nameModalOpen])

  const handleSaveName = () => {
    const next = saveDisplayName(draftName)
    setDraftName(next)
    setNameModalOpen(false)
  }

  return (
    <main className="doc-shell">
      <Toolbar.Root className="doc-toolbar" aria-label="Document toolbar">
        <div className="doc-toolbar__crumbs">
          <Button
            className="crumb-button"
            onClick={() => {
              void navigate({ to: '/' })
            }}
          >
            Home
          </Button>
          <LuChevronRight aria-hidden="true" />
          <span className="crumb-current">
            <LuFileText aria-hidden="true" />
            <span>{title}</span>
          </span>
        </div>

        {awareness && (
          <div className="doc-toolbar__presence">
            <PresenceBar
              awareness={awareness}
              localClientId={localClientId}
              onClickLocal={() => setNameModalOpen(true)}
            />
          </div>
        )}

        <Button
          className="chat-toggle-btn"
          aria-label={chatOpen ? 'Close chat' : 'Open chat'}
          onClick={() => setChatOpen((v) => !v)}
        >
          {chatOpen ? <LuX aria-hidden="true" /> : <LuMessageSquare aria-hidden="true" />}
        </Button>
      </Toolbar.Root>

      <div className="doc-shell__body">
        <div className="doc-pane doc-pane--editor">
          <Toolbar.Root className="editor-float-toolbar" aria-label="Formatting">
            <div className="editor-float-toolbar__group">
              {TOOLBAR_GROUPS.map((group, gi) => (
                <span key={gi} className="editor-float-toolbar__segment">
                  {gi > 0 && <span className="editor-float-toolbar__sep" aria-hidden="true" />}
                  {group.map(({ action, label, icon: Icon }) => (
                    <Toolbar.Button
                      key={action}
                      className={`toolbar-button${activeState?.[action] ? ' toolbar-button--active' : ''}`}
                      aria-label={label}
                      aria-pressed={activeState?.[action] ?? false}
                      disabled={!editorController}
                      onClick={() => editorController?.exec(action)}
                    >
                      <Icon aria-hidden="true" />
                    </Toolbar.Button>
                  ))}
                </span>
              ))}
            </div>
          </Toolbar.Root>
          <div className="editor-scroll">
            <div className="doc-pane__content">
              <CollaborativeEditor
                docKey={docKey}
                localUserName={ready ? displayName : 'Guest'}
                onControllerChange={setEditorController}
                onConnectionStateChange={setEditorState}
                onActiveStateChange={setActiveState}
                onAwarenessChange={(aw, id) => {
                  setAwareness(aw)
                  setLocalClientId(id)
                }}
              />
            </div>
          </div>
        </div>

        <Separator className="pane-separator" orientation="vertical" />

        <div className={`doc-pane doc-pane--chat${chatOpen ? ' doc-pane--chat-open' : ''}`}>
          <ChatSidebar
            docKey={docKey}
            sessionId={sessionId}
            displayName={ready ? displayName : 'Guest'}
            onStatusChange={setChatState}
          />
        </div>

        {chatOpen && (
          <div
            className="chat-overlay-backdrop"
            onClick={() => setChatOpen(false)}
          />
        )}
      </div>

      {nameModalOpen && (
        <div
          className="name-modal-overlay"
          onClick={() => setNameModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Edit your display name"
        >
          <div
            className="name-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="name-modal__label">Your display name</p>
            <Input
              ref={nameInputRef}
              className="name-modal__input"
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveName()
                if (e.key === 'Escape') setNameModalOpen(false)
              }}
              placeholder="Display name"
            />
            <div className="name-modal__actions">
              <Button
                className="name-modal__btn name-modal__btn--cancel"
                onClick={() => setNameModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                className="name-modal__btn name-modal__btn--save"
                onClick={handleSaveName}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      <footer className="status-bar">
        <div className="status-bar__item">
          Editor {editorState.status} {editorState.synced ? '· synced' : '· syncing'}
        </div>
        <div className="status-bar__item">
          Chat {chatState.connectionStatus}
          {chatState.subscribed ? ' · subscribed' : ''}
        </div>
        <div className="status-bar__item">
          Participants {editorState.collaboratorCount}
        </div>
        <div className="status-bar__item">
          Session {chatState.busy ? 'running' : 'idle'}
        </div>
      </footer>
    </main>
  )
}
