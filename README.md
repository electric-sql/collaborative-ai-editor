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
```

3. Create `.env.development`:

```bash
VITE_DURABLE_STREAMS_BASE_URL=http://127.0.0.1:4438
VITE_YJS_SERVICE_NAME=y-llm-demo-v2
VITE_YJS_DOC_LAYOUT_VERSION=v3
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

