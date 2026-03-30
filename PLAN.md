# Demo goal

Build a TanStack Start demo where an LLM appears inside a collaborative ProseMirror editor as a real collaborator named something like **Electra**. The AI should join with its own presence, remote cursor, and selection, and its writing should **stream into the shared Yjs document progressively** rather than arriving as a single final patch. The visible editor should use `@handlewithcare/react-prosemirror`, which is an alternate `EditorView` implementation that uses React for rendering and exposes hooks like `useEditorEffect` for effects that need to run after the editor view is updated. The collaborative binding should use `y-prosemirror`, which maps a `Y.XmlFragment` to ProseMirror state and provides plugins for sync, cursors, and undo/redo. ([GitHub][1])

Use TanStack Start for the app shell and HTTP endpoints. TanStack Start supports full-document SSR, streaming, server routes, and server functions, so it is a good fit for an editor app with a streaming LLM endpoint. Run the model chat loop on the server and apply stable chunks directly into the server-side Yjs document (`Y.Doc`) so document writes are authoritative and not dependent on a browser-local hidden editor. For the user-facing chat sidebar, use the Durable Streams TanStack AI transport (`@durable-streams/tanstack-ai-transport`) so chat sessions are resilient across refresh/reconnect and can be shared across tabs/devices. For the UI layer, use [Base UI](http://base-ui.com) components and style the interface with plain CSS. ([TanStack][2]) ([Durable Streams TanStack AI][12])

## Product shape for the first demo

The first demo should support exactly three actions: **continue writing at cursor**, **insert at cursor**, and **rewrite current selection**. Do not try to solve arbitrary structured rich-text generation in v1. Keep the schema modest and text-centric: paragraphs, headings, bold, italic, code, bullet lists, ordered lists, and maybe blockquotes. The important point is to prove the collaboration model, not to solve every editor feature at once.

The user should see:

* their own ProseMirror editor
* the AI join as a separate collaborator with a name/color
* the AI cursor move to the target range
* text appear progressively in the document
* an ephemeral “composing tail” near the cursor while the next chunk is still unstable
* a chat sidebar to send prompts/messages to the LLM
* cancel / stop generation
* another browser tab can edit concurrently and the AI should keep writing in the right semantic place

This “real collaborator” feel is supported by Yjs’s collaboration model: awareness is separate from document content and is meant for user status and cursor/presence, while document content sync is handled by shared types and provider updates. Use `@durable-streams/y-durable-streams` as the provider for this demo so document updates stream over plain HTTP (SSE or long-poll) and avoid running a dedicated WebSocket service. The provider also supports optional awareness syncing for presence and cursors. ([Durable Streams][10])

## Core architecture

Run a **local Durable Streams dev server** for this demo environment. Use the Node dev server from `@durable-streams/server` during development/testing, bind it locally, and use file-backed `dataDir` persistence so document state survives app restarts while iterating. This server is a required dependency for collaboration in the demo, not an optional extra. ([Durable Streams Deployment][11])

Each document must have **two Durable Streams channels**:

1. **Document collaboration stream set**

   * one durable stream for Yjs document updates
   * one paired awareness/presence stream for collaborator status/cursors
   * both used by `@durable-streams/y-durable-streams` `YjsProvider`

2. **Chat session stream**

   * one durable stream for TanStack AI chat session events (messages, chunks, tool calls)
   * used by the chat sidebar via the Durable Streams connection adapter

Use **two peers**, but not both in-browser:

1. **Human peer**

   * visible `react-prosemirror` editor
   * own `Y.Doc`
   * own `YjsProvider` connection to the same Durable Streams doc path
   * normal awareness state

2. **Agent peer (server-side)**

   * server process with a dedicated `Y.Doc` + `YjsProvider` connection to the same Durable Streams doc path
   * separate awareness identity (`name`, `color`, `role: "agent"`, `status`)
   * runs the model loop and applies stable writes directly to the server `Y.Doc`

The reason to keep the agent as a separate peer is still the same: awareness is per-client and `yCursorPlugin` already renders remote collaborators from provider awareness. A separate server peer preserves collaborator semantics while moving write authority to the backend. ([docs.yjs.dev][3])

## Non-negotiable design rule

Do **not** model the generation as “LLM returns diffs for the whole document.” Model it as **a live collaborator that writes through a stable anchor plus a mutable tail**.

Yjs explicitly warns that index positions are not reliable for collaborative ProseMirror use and says to use **relative positions** instead. Relative positions stay attached to the same semantic place even as remote edits happen. ([docs.yjs.dev][4])

That means every AI session should be anchored as:

* insert mode: one `RelativePosition`
* rewrite mode: start and end `RelativePosition`s

Store them encoded if needed. Resolve them back to absolute positions each time you are ready to commit another stable chunk. Yjs provides `createRelativePositionFromTypeIndex`, `createAbsolutePositionFromRelativePosition`, `encodeRelativePosition`, and `decodeRelativePosition` for this. ([docs.yjs.dev][5])

## Streaming model

Build the system around three streaming layers:

### 1. Durable chat session stream (sidebar)

Use the Durable Streams TanStack AI transport for chat session resilience. The sidebar client should connect with a durable connection adapter (`sendUrl` + `readUrl`), and server routes should write model outputs into the durable chat session stream. ([Durable Streams TanStack AI][12])

### 2. Server-side document write loop

Run `chat()` on the server and pipe chunks into a server `AgentSessionController` that:

* receives streamed text chunks
* updates the agent peer awareness state via the server-side provider
* buffers text into `committed` and `tail`
* decides what part is stable enough to commit
* resolves relative anchors and applies writes directly to the server `Y.Doc`

This keeps Yjs writes authoritative on the server while clients simply observe synced CRDT updates.

### 3. Client editor sync + composing tail UI

Maintain two buffers:

* `committed`: already inserted into server `Y.Doc`
* `tail`: currently visible as ephemeral composing output but not yet committed

Commit only at safe boundaries such as:

* whitespace or punctuation boundary
* sentence boundary
* paragraph boundary
* or every 50–120 ms if the tail is already clean enough

That timing heuristic is an implementation recommendation. The goal is to avoid per-token CRDT churn while preserving the feeling of live typing.

## Presence and cursor behavior

Use Yjs awareness for the agent’s presence. Awareness is a separate CRDT for non-persistent collaboration state like who is online, cursor location, username, or email. It stores schemaless JSON per client, and providers typically expose it as `provider.awareness`. With Durable Streams, each doc should include its paired presence stream and each peer should pass an `Awareness` instance to its `YjsProvider` so presence/cursor state syncs independently from document text. ([docs.yjs.dev][3]) ([Durable Streams][10])

The human editor should use:

* `ySyncPlugin(type, { mapping })`
* `yCursorPlugin(provider.awareness, { cursorBuilder })`
* `yUndoPlugin()`

That is the documented `y-prosemirror` setup. Use a custom `cursorBuilder` so the AI caret and badge clearly look like an assistant rather than a human collaborator. `y-prosemirror` shows how to set local awareness user data and how to customize cursor rendering. ([GitHub][8])

For the agent’s transient “thinking / composing / revising” UI, add a lightweight overlay in React, positioned relative to the editor with `useEditorEffect`. The `react-prosemirror` docs explicitly call out `useEditorEffect` for cases where you need to position UI relative to editor positions after the `EditorView` and decorations are up to date. ([GitHub][1])

## Editor write algorithm

Implement AI writing as updates to the **server-side Y.Doc**.

For **insert mode**:

* capture current selection/cursor from the visible editor
* convert the insertion point to a Y relative position
* move agent awareness cursor there from the server peer
* stream output
* repeatedly resolve relative position to current absolute location
* apply stable chunk writes into the server doc at resolved positions
* advance the session anchor to the end of the inserted text

For **rewrite mode**:

* capture current selection start/end
* convert both to relative positions
* keep original content visible initially
* show AI tail as an overlay first
* progressively replace from left to right as text stabilizes
* avoid deleting the entire original selection upfront

This progressive replacement approach is a design recommendation. It will feel much safer and less jumpy than blanking the selected content before the model has anything coherent to show.

## Transaction and undo policy

All AI-applied transactions should have a distinct origin, for example:

```ts
const AGENT_ORIGIN = { source: 'agent', sessionId }
```

Yjs transactions can carry an origin, and Yjs update listeners receive it. This is useful for filtering analytics, debugging, and undo policy. Yjs also documents transaction origins at both `doc.transact(..., origin)` and `Y.applyUpdate(..., origin)`. ([docs.yjs.dev][9])

AI transactions should also set `addToHistory = false` unless you intentionally want them in the local undo stack. `y-prosemirror` documents that undo/redo is local per client and notes that `addToHistory: false` prevents programmatic changes from being rolled back by undo. Yjs `UndoManager` also supports tracking origins selectively. ([GitHub][8])

## Suggested module breakdown

Use this file shape:

* `src/lib/editor/schema.ts`
* `src/lib/editor/createHumanEditor.ts`
* `src/lib/yjs/createRoomProvider.ts`
* `src/lib/yjs/streamIds.ts`
* `src/lib/agent/serverAgentSession.ts`
* `src/lib/agent/serverAgentSessionController.ts`
* `src/lib/agent/relativeAnchors.ts`
* `src/lib/agent/stability.ts`
* `src/lib/agent/prompts.ts`
* `src/lib/chat/createDurableChatConnection.ts`
* `src/routes/api/chat.ts`
* `src/routes/api/chat-stream.ts`
* `src/routes/api/agent/run.ts`
* `src/dev/durableStreamsServer.ts`
* `src/components/CollaborativeEditor.tsx`
* `src/components/ChatSidebar.tsx`
* `src/components/AgentOverlay.tsx`
* `src/components/PresenceBar.tsx`

## Milestones for the coding agent

### Milestone 0: local Durable Streams server

Add and wire a local dev server process using `DurableStreamTestServer` from `@durable-streams/server` (default local host binding, explicit port, and file-backed `dataDir` for persistence). Add a dev workflow so the app and Durable Streams server can run together. Verify the editor provider `baseUrl` points at this local server. ([Durable Streams Deployment][11])

### Milestone 1: per-doc stream topology

Define deterministic stream IDs for each document:

* doc collaboration stream path
* doc presence stream path
* chat session stream path

Wire clients/providers/routes against these IDs consistently.

### Milestone 2: baseline collaborative editor

Build a visible `react-prosemirror` editor wired to a `Y.Doc` via `y-prosemirror`, with remote cursors and local undo/redo. Use `Y.XmlFragment` as the shared rich-text type, and connect that doc through `YjsProvider` from `@durable-streams/y-durable-streams` (SSE live mode by default). ([GitHub][8]) ([Durable Streams][10])

### Milestone 3: chat sidebar over durable transport

Build the sidebar chat UI and wire it to Durable Streams transport with `sendUrl`/`readUrl` routes (`/api/chat` + `/api/chat-stream`) so sessions resume across refreshes and reconnects. ([Durable Streams TanStack AI][12])

### Milestone 4: server agent peer + write route

Create a server-side agent peer with its own awareness identity and provider connection. Add a route (for example `/api/agent/run`) that runs the LLM chat loop and edits the server `Y.Doc` directly using stable-prefix commits.

### Milestone 5: insert mode

Implement “continue writing” and “insert at cursor” using relative-position anchors and stable-prefix commits.

### Milestone 6: rewrite mode

Implement “rewrite selection” using start/end relative positions and progressive replacement. Keep this limited to textblock content in v1.

### Milestone 7: overlay tail

Add a React overlay for the mutable tail, positioned with `useEditorEffect`, and an AI status pill driven by awareness state.

### Milestone 8: concurrency test

Open two tabs. While the AI writes in one tab, edit nearby content in the other. The AI should continue writing at the intended semantic position, not at a stale integer offset. This is exactly why Yjs recommends relative positions over indexes for collaborative ProseMirror work. ([docs.yjs.dev][4])

## Acceptance criteria

The demo is done when all of these are true:

* The AI appears as a distinct collaborator with name/color/cursor.
* AI-generated text streams into the shared doc incrementally.
* Another collaborator can type concurrently without breaking the AI’s insertion point.
* The visible editor remains schema-valid.
* AI changes do not pollute normal user undo history unless explicitly intended.
* Cancel stops the model stream and clears transient UI cleanly.
* Refreshing one tab preserves the collaborative document state through the normal Yjs provider path.
* The local Durable Streams dev server starts reliably, and both human/agent peers connect through it.
* Chat sidebar sessions resume after refresh/reconnect using the document’s durable chat stream.
* Every doc has exactly: one Yjs collaboration stream, one Yjs presence stream, and one chat session stream.


[1]: https://github.com/handlewithcarecollective/react-prosemirror "GitHub - handlewithcarecollective/react-prosemirror: A library for safely integrating ProseMirror and React. · GitHub"
[2]: https://tanstack.com/start/v0/docs/framework/react/overview "TanStack Start Overview | TanStack Start React Docs"
[3]: https://docs.yjs.dev/api/about-awareness "Awareness | Yjs Docs"
[4]: https://docs.yjs.dev/ecosystem/editor-bindings/prosemirror "ProseMirror | Yjs Docs"
[5]: https://docs.yjs.dev/api/relative-positions "Y.RelativePosition | Yjs Docs"
[6]: https://tanstack.com/ai/latest/docs/api/ai "@tanstack/ai | TanStack AI Docs"
[7]: https://tanstack.com/ai/latest/docs/guides/streaming "Streaming | TanStack AI Docs"
[8]: https://github.com/yjs/y-prosemirror "GitHub - yjs/y-prosemirror: ProseMirror editor binding for Yjs · GitHub"
[9]: https://docs.yjs.dev/api/y.doc?utm_source=chatgpt.com "Y.Doc"
[10]: https://durablestreams.com/yjs "Yjs | Durable Streams"
[11]: https://durablestreams.com/deployment "Deployment | Durable Streams"
[12]: https://durablestreams.com/tanstack-ai "TanStack AI | Durable Streams"
