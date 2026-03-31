# y-llm demo

TanStack Start demo of a collaborative ProseMirror editor where an AI collaborator ("Electra") writes into a shared Yjs document.

## What this repo runs

- `localhost:3000` - TanStack Start app (editor + chat UI)
- `127.0.0.1:4437` - Durable Streams server (raw stream storage)
- `127.0.0.1:4438` - Yjs protocol server (`@durable-streams/y-durable-streams/server`)

The app uses the Yjs server URL at `http://127.0.0.1:4438/v1/yjs/y-llm-demo-v2`.

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

Start app + Durable Streams + Yjs server together:

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
- `npm run typecheck` - TypeScript checks
- `npm run build` - production build
- `npm run preview` - preview production output

## Behavior notes

- Left pane: shared document
- Right pane: chat
- Chat message triggers server-side generation and document edits
- Document key is used for both Yjs room naming and chat stream namespacing

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

### Chat stream 404 on first load

- The server route now auto-creates chat streams on read.
- If you still see 404, restart dev server and hard refresh.

