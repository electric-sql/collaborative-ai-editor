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
  LuChevronDown,
  LuCode,
  LuFileText,
  LuHeading1,
  LuHeading2,
  LuHeading3,
  LuIndentDecrease,
  LuIndentIncrease,
  LuItalic,
  LuList,
  LuListOrdered,
  LuMessageSquare,
  LuRedo2,
  LuShare2,
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
    { action: 'code', label: 'Inline code', icon: LuCode },
  ],
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

const HEADING_MENU_ITEMS: Array<{ action: EditorToolbarAction; label: string; icon: typeof LuBold }> = [
  { action: 'paragraph', label: 'Paragraph', icon: LuFileText },
  { action: 'heading1', label: 'Heading 1', icon: LuHeading1 },
  { action: 'heading2', label: 'Heading 2', icon: LuHeading2 },
  { action: 'heading3', label: 'Heading 3', icon: LuHeading3 },
  { action: 'heading4', label: 'Heading 4', icon: LuHeading3 },
]

function DocumentPage() {
  const { name } = Route.useParams()
  const navigate = Route.useNavigate()
  const docKey = name.trim()
  const sessionId = 'main'
  const { displayName, saveDisplayName, ready } = useStoredDisplayName()
  const [draftName, setDraftName] = useState(displayName)
  const [nameModalOpen, setNameModalOpen] = useState(false)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [chatOpen, setChatOpen] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const shareInputRef = useRef<HTMLInputElement>(null)
  const headingMenuRef = useRef<HTMLDetailsElement>(null)

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

  useEffect(() => {
    if (shareModalOpen) {
      setCopyState('idle')
      setTimeout(() => shareInputRef.current?.select(), 30)
    }
  }, [shareModalOpen])

  const handleSaveName = () => {
    const next = saveDisplayName(draftName)
    setDraftName(next)
    setNameModalOpen(false)
  }

  const shareUrl =
    typeof window !== 'undefined' ? window.location.href : `http://localhost:3000/doc/${encodeURIComponent(docKey)}`

  const handleCopyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopyState('copied')
    } catch {
      setCopyState('error')
    }
  }

  const handleNativeShare = async () => {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return
    try {
      await navigator.share({
        title,
        text: `Join me in ${title}`,
        url: shareUrl,
      })
    } catch {
      // user cancelled or share failed; keep modal open
    }
  }

  const currentHeadingItem =
    HEADING_MENU_ITEMS.find(({ action }) => activeState?.[action]) ??
    HEADING_MENU_ITEMS.find(({ action }) => action === 'paragraph')!
  const HeadingTriggerIcon = currentHeadingItem.icon

  const runHeadingAction = (action: EditorToolbarAction) => {
    editorController?.exec(action)
    if (headingMenuRef.current) {
      headingMenuRef.current.open = false
    }
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
                  {gi === 1 && (
                    <>
                      <details ref={headingMenuRef} className="toolbar-dropdown">
                        <summary
                          className="toolbar-button toolbar-dropdown__summary"
                          aria-label="Headings and paragraph"
                        >
                          <HeadingTriggerIcon aria-hidden="true" />
                          <LuChevronDown aria-hidden="true" className="toolbar-dropdown__chevron" />
                        </summary>
                        <div className="toolbar-dropdown__menu" role="menu" aria-label="Headings">
                          {HEADING_MENU_ITEMS.map(({ action, label, icon: Icon }) => (
                            <button
                              key={action}
                              type="button"
                              className={`toolbar-dropdown__item${activeState?.[action] ? ' toolbar-dropdown__item--active' : ''}`}
                              role="menuitemradio"
                              aria-checked={activeState?.[action] ?? false}
                              onClick={() => runHeadingAction(action)}
                            >
                              <Icon aria-hidden="true" />
                              <span>{label}</span>
                            </button>
                          ))}
                        </div>
                      </details>
                      <span className="editor-float-toolbar__sep" aria-hidden="true" />
                    </>
                  )}
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
                  {gi === TOOLBAR_GROUPS.length - 1 && (
                    <>
                      <span className="editor-float-toolbar__sep" aria-hidden="true" />
                      <Toolbar.Button
                        className="toolbar-button"
                        aria-label="Share document"
                        disabled={false}
                        onClick={() => setShareModalOpen(true)}
                      >
                        <LuShare2 aria-hidden="true" />
                      </Toolbar.Button>
                    </>
                  )}
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

      {shareModalOpen && (
        <div
          className="name-modal-overlay"
          onClick={() => setShareModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Share document"
        >
          <div
            className="name-modal share-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="name-modal__label">Share this document</p>
            <Input
              ref={shareInputRef}
              className="name-modal__input"
              type="text"
              value={shareUrl}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Share URL"
            />
            <div className="share-modal__hint">
              {copyState === 'copied'
                ? 'URL copied.'
                : copyState === 'error'
                  ? 'Could not copy URL.'
                  : 'Anyone with the link can open this document.'}
            </div>
            <div className="name-modal__actions">
              <Button
                className="name-modal__btn name-modal__btn--cancel"
                onClick={() => setShareModalOpen(false)}
              >
                Close
              </Button>
              <Button
                className="name-modal__btn share-modal__btn"
                onClick={() => {
                  void handleCopyShareUrl()
                }}
              >
                Copy URL
              </Button>
              <Button
                className="name-modal__btn name-modal__btn--save"
                onClick={() => {
                  void handleNativeShare()
                }}
                disabled={typeof navigator === 'undefined' || typeof navigator.share !== 'function'}
              >
                Share
              </Button>
            </div>
          </div>
        </div>
      )}

      <footer className="status-bar">
        <a
          className="status-bar__item status-bar__link"
          href="https://durablestreams.com"
          target="_blank"
          rel="noreferrer"
        >
          Durable Streams
        </a>
        <a
          className="status-bar__item status-bar__link"
          href="http://electric-sql.com/"
          target="_blank"
          rel="noreferrer"
        >
          ElectricSQL
        </a>
        <a
          className="status-bar__item status-bar__link"
          href="http://tanstack.com/ai/"
          target="_blank"
          rel="noreferrer"
        >
          TanStack AI
        </a>
        <a
          className="status-bar__item status-bar__link"
          href="http://yjs.dev"
          target="_blank"
          rel="noreferrer"
        >
          Yjs
        </a>
        <a
          className="status-bar__item status-bar__link"
          href="http://prosemirror.net"
          target="_blank"
          rel="noreferrer"
        >
          ProseMirror
        </a>
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
