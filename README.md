# Collaborative AI Editor

This repo is a demo of [Durable Streams](http://durablestreams.com) as the transport and persistence layer for a collaborative AI writing app.

The app combines two Durable Streams integrations:

1. [Durable Streams + Yjs](https://durablestreams.com/yjs) for shared ProseMirror document collaboration over plain HTTP.
2. [Durable Streams + TanStack AI](https://durablestreams.com/tanstack-ai) for resilient chat sessions, streamed model output, and tool-driven agent interaction.

On top of that, the demo shows an AI collaborator called `Electra` that can:

- join a collaborative document as a separate participant
- inspect and edit the shared document through tools
- stream generated content into the document
- stream its activity into chat
- survive refreshes and reconnects through Durable Streams-backed session state

## What the app demonstrates

At a high level, this app is demonstrating one core idea:

- Durable Streams can act as the shared, resumable HTTP data plane for both collaborative editing and collaborative agent/chat workflows in the same application.

In practice that means:

- the document is a shared Yjs/ProseMirror document
- presence and document updates are synchronized through the Durable Streams Yjs provider
- chat messages and model/tool stream events are synchronized through the Durable Streams TanStack AI transport
- multiple tabs/devices can reconnect and resume both document state and chat state

## Tech stack

### App framework

- [`TanStack Start`](https://tanstack.com/start) powers the full-stack app shell, server routes, and development workflow.
- [`TanStack Router`](https://tanstack.com/router) handles file-based routing for the homepage, document page, and API endpoints.
- [`React`](https://react.dev) renders the editor UI, chat UI, and collaboration chrome.
- [`Vite`](https://vite.dev) provides the local dev server and build pipeline.
- [`TypeScript`](https://www.typescriptlang.org) provides the application’s static typing and editor tooling.

### Collaborative editor

- [`ProseMirror`](https://prosemirror.net) is the structured rich-text editor model used for the shared document.
- [`@handlewithcare/react-prosemirror`](https://github.com/handlewithcarecollective/react-prosemirror) provides a React-friendly ProseMirror integration layer.
- [`Yjs`](https://yjs.dev) is the CRDT used for collaborative document state.
- [`y-prosemirror`](https://github.com/yjs/y-prosemirror) binds the ProseMirror document to the shared Yjs state.
- [`y-protocols`](https://github.com/yjs/y-protocols) provides awareness/presence support for cursors and participant state.

### Durable Streams integrations

- [`@durable-streams/y-durable-streams`](https://durablestreams.com/yjs) syncs the Yjs document over Durable Streams using plain HTTP.
- [`@durable-streams/tanstack-ai-transport`](https://durablestreams.com/tanstack-ai) provides durable chat session transport for TanStack AI.
- [`@durable-streams/server`](https://durablestreams.com) runs the local Durable Streams server used by the demo.

### AI stack

- [`@tanstack/ai`](http://tanstack.com/ai/) runs the model/tool loop and stream processing.
- [`@tanstack/ai-react`](http://tanstack.com/ai/) provides the `useChat` hook used by the sidebar chat UI.
- [`@tanstack/ai-openai`](http://tanstack.com/ai/) connects the app’s agent loop to OpenAI models.
- [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses) is the underlying model API used for generation.

### Agent editing/runtime

- A tool-driven document editing runtime coordinates selection, insertion, deletion, rewrite, and formatting operations on the shared document.
- Streamed insertion and rewrite flows let the agent progressively update the document rather than applying one final patch at the end.
- [`streaming-markdown`](https://github.com/thetarnav/streaming-markdown) is used to interpret streamed markdown into structured editor content.
- [`zod`](https://zod.dev) validates tool inputs and keeps the tool contract typed and explicit.

### UI

- [`@base-ui/react`](https://base-ui.com) provides unstyled accessible primitives for the UI.
- [`react-icons`](https://react-icons.github.io/react-icons/) supplies the toolbar and chrome icons.
- Plain CSS styles the editor, homepage, chat UI, tool disclosures, and modals without an extra styling framework.

### Testing and verification

- [`Vitest`](https://vitest.dev) runs deterministic unit tests for the editor, tools, routing, and markdown behavior.
- Live model-backed evals run against OpenAI to verify actual tool usage and document-editing behavior end to end.

## What this repo runs

- `localhost:3000` - TanStack Start app (editor + chat UI)
- `127.0.0.1:4437` - Durable Streams server
- `127.0.0.1:4438` - Yjs server backed by Durable Streams (`@durable-streams/y-durable-streams/server`)

The app uses the Yjs base URL:

- `http://127.0.0.1:4438/v1/yjs/y-llm-demo-v2`

## Prerequisites

- Node.js 20+
- npm 10+

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` in the repo root:

```bash
OPENAI_API_KEY=your_openai_key_here
OPENAI_MODEL=gpt-5.4

# Optional server-side upstream config for Durable Streams services
# DURABLE_STREAMS_YJS_BASE_URL=http://127.0.0.1:4438
# DURABLE_STREAMS_CHAT_BASE_URL=http://127.0.0.1:4437
# DURABLE_STREAMS_YJS_SECRET=your-yjs-secret
# DURABLE_STREAMS_CHAT_SECRET=your-chat-secret
```

## Run locally

Start the app, Durable Streams server, and Yjs server together:

```bash
npm run dev
```

Open:

- `http://localhost:3000`

On first load, enter a document name to create/join a room.

## Development scripts

- `npm run dev` - run app + servers together
- `npm run dev:app` - run app only
- `npm run dev:ds` - run Durable Streams + Yjs servers only
- `npm run test:unit` - deterministic unit tests
- `npm run test:evals` - live model-backed evals
- `npm run typecheck` - TypeScript checks
- `npm run build` - production build
- `npm run preview` - preview production output

## App behavior

- Left pane: shared collaborative document
- Right pane: resilient chat session
- Chat and agent events are backed by Durable Streams
- Document collaboration is backed by Yjs over Durable Streams
- The agent can perform tool-driven document edits and stream insertions into the shared doc
- Document key is used for both Yjs room naming and chat session namespacing

## Architecture notes

- The editor is a ProseMirror document synchronized through Yjs.
- The Yjs provider is `@durable-streams/y-durable-streams`, so collaboration works over HTTP rather than a dedicated WebSocket stack.
- The chat sidebar uses `@durable-streams/tanstack-ai-transport`, so model responses, tool calls, and resumable session history flow through Durable Streams.
- The server-side agent keeps its own editing/runtime state and writes back into the shared document.

## Troubleshooting

### `Durable Streams Yjs: connecting — synced: no`

- Make sure `npm run dev` is running.
- Confirm ports are listening:
  - `127.0.0.1:4437` (Durable Streams)
  - `127.0.0.1:4438` (Yjs server)
- Hard refresh the browser after server restarts.
- Check browser network for Yjs requests to:
  - `/v1/yjs/y-llm-demo-v2/docs/rooms/<doc>/v3/collaboration?...`

### Chat works but AI generation fails

- Verify `OPENAI_API_KEY` exists in `.env`.
- Restart `npm run dev` after changing env vars.
- Check `/api/chat` response body for server error text.

### Live evals fail unexpectedly

- Verify `OPENAI_API_KEY` and `OPENAI_MODEL` in `.env`.
- Start with `gpt-5.4`, which is the current baseline used in this repo.
- Re-run `npm run test:evals`.

### Chat stream 404 on first load

- The server route now auto-creates chat streams on read.
- If you still see 404, restart dev server and hard refresh.

