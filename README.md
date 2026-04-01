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
- pnpm 10+

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Create `.env` in the repo root:

```bash
OPENAI_API_KEY=your_openai_key_here
OPENAI_MODEL=gpt-5.4
APP_BASE_URL=http://localhost:3000
PUBLIC_APP_BASE_URL=http://localhost:3000

# Optional server-side upstream config for Durable Streams services
# DURABLE_STREAMS_YJS_BASE_URL=http://127.0.0.1:4438
# DURABLE_STREAMS_CHAT_BASE_URL=http://127.0.0.1:4437
# DURABLE_STREAMS_YJS_SECRET=your-yjs-secret
# DURABLE_STREAMS_CHAT_SECRET=your-chat-secret
```

## Run locally

Start the app, Durable Streams server, and Yjs server together:

```bash
pnpm dev
```

Open:

- `http://localhost:3000`

On first load, enter a document name to create/join a room.

## Development scripts

- `pnpm dev` - run app + servers together
- `pnpm dev:app` - run app only
- `pnpm dev:ds` - run Durable Streams + Yjs servers only
- `pnpm test:unit` - deterministic unit tests
- `pnpm test:evals` - live model-backed evals
- `pnpm typecheck` - TypeScript checks
- `pnpm build` - production build
- `pnpm preview` - build and preview the Cloudflare Worker locally with Wrangler
- `pnpm preview:vite` - preview the raw Vite output
- `pnpm preview:cloudflare` - build and preview the Cloudflare Worker locally with Wrangler
- `pnpm deploy:cloudflare` - build and deploy the app to Cloudflare Workers
- `pnpm cf:typegen` - generate Wrangler types if you add Cloudflare bindings later

## Deploy to Cloudflare Workers

This repo is configured to deploy the TanStack Start app to Cloudflare Workers via Nitro's
`cloudflare_module` preset.

What runs on Cloudflare:

- the app shell
- SSR/server routes
- `/api/chat`
- `/api/chat-stream`
- `/api/yjs/*` proxy routes

What does not run on Cloudflare in this repo:

- the local Durable Streams dev server in `src/dev/durableStreamsServer.ts`

Before deploying, make sure your production Durable Streams services are already hosted and
reachable from the public internet. The Worker cannot use `127.0.0.1`.

### Cloudflare config in this repo

- `nitro.config.mjs` targets Cloudflare Workers and emits `.output/server/wrangler.json`
- `wrangler.jsonc` defines the Worker name plus non-secret defaults for the custom domain
- `.dev.vars.example` shows the env vars needed for local Wrangler preview

### Required Worker environment variables

Set these in the Cloudflare dashboard or with Wrangler:

- `APP_BASE_URL=https://collaborative-ai-editor.examples.electric-sql.com`
- `PUBLIC_APP_BASE_URL=https://collaborative-ai-editor.examples.electric-sql.com`
- `OPENAI_MODEL=gpt-5.4`
- `DURABLE_STREAMS_YJS_BASE_URL=<hosted yjs upstream>`
- `DURABLE_STREAMS_CHAT_BASE_URL=<hosted chat upstream>`

For the Durable Streams values, this app supports either format:

- a plain origin such as `https://api.electric-sql.cloud`
- a full service URL such as `https://api.electric-sql.cloud/v1/yjs/<service-id>` or
  `https://api.electric-sql.cloud/v1/stream/<service-id>`

Set these as secrets if you use them:

- `OPENAI_API_KEY`
- `DURABLE_STREAMS_YJS_SECRET`
- `DURABLE_STREAMS_CHAT_SECRET`

### Local preview with Wrangler

1. Copy `.dev.vars.example` to `.dev.vars`.
2. Replace the placeholder Durable Streams URLs with your real hosted upstreams.
3. Set the real `OPENAI_API_KEY`.
4. Run:

```bash
pnpm preview:cloudflare
```

### Production deploy

1. Authenticate Wrangler:

```bash
pnpm exec wrangler login
```

2. Build and deploy:

```bash
pnpm deploy:cloudflare
```

3. In the Cloudflare dashboard, add the custom domain:

- `collaborative-ai-editor.examples.electric-sql.com`

Use a custom domain because the Worker is the application origin.

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

- Make sure `pnpm dev` is running.
- Confirm ports are listening:
  - `127.0.0.1:4437` (Durable Streams)
  - `127.0.0.1:4438` (Yjs server)
- Hard refresh the browser after server restarts.
- Check browser network for Yjs requests to:
  - `/v1/yjs/y-llm-demo-v2/docs/rooms/<doc>/v3/collaboration?...`

### Chat works but AI generation fails

- Verify `OPENAI_API_KEY` exists in `.env`.
- Restart `pnpm dev` after changing env vars.
- Check `/api/chat` response body for server error text.

### Live evals fail unexpectedly

- Verify `OPENAI_API_KEY` and `OPENAI_MODEL` in `.env`.
- Start with `gpt-5.4`, which is the current baseline used in this repo.
- Re-run `pnpm test:evals`.

### Chat stream 404 on first load

- The server route now auto-creates chat streams on read.
- If you still see 404, restart dev server and hard refresh.

