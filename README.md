
# Electric Transport

Durable stream transport, proxy and AI SDK adapters.

## Packages

- `proxy` -- node service that proxies
  - backend API requests
  - Electric shape streams

- `transport` -- protocol agnostic transport library with
  - proxy-aware, resilient fetch client
  - storage utilities

- `*-transport` -- protocol specific adapters
  - `ai-transport` for the Vercel AI SDK
  - `tanstack-ai-transport` for TanStack AI
  - ... more coming soon ...

### Seperation of concerns

The `proxy` and `transport` packages should be entirely protocol agnostic.
Keep them that way!

## How it works

### Resilient transport

1. SDK adapters
  - configure the chat UIs to use the durable fetchClient

2. fetchClient
  - routes the API request via the proxy

3. the proxy
  - proxies the request to the backend API
  - writes the response to a shape/stream
  - sends back stream urls to the fetchClient

4. fetchClient
  - consumes data and control streams
  - emits the data stream as a standard response

### Persistence

Currently message persistence is all handled by the SDK adapters and localStorage.

There's no server-side persistence or specific protocol-aware proxy services.

### Resumability

1. SDK adapters
  - configure the chat UIs to reconnect with specific headers

2. fetchClient
  - records active generations in localStorage by default
  - looks for headers like `X-Resume-Active-Generation`
  - if present, resumes the active generation when requested

### Stream protocol

Currently implemented on-top of Postgres using Electric shapes.

Designed to be easily swappable to the new durable streams protocol via a dual
`data` and `control` stream pattern, aligned with a `lastReceivedRowId` value
that can be swapped for the `Stream-Next-Offset` when we have that returned
from writes to the new dirable streams.

This allows the data stream to be a pure binary stream, with a control stream of
transport specific messages handling `done` and `error`s. When the client recieves
a done or error message, it waits to make sure it's recieves all the preceding data
before closing the data stream. Thus preventing race conditions across the two streams.

#### Note on IDS

We currently use `sessionId` and `requestId` identifiers in the database tables.
We can move to just a `streamId` when we have this.

## Demos

Standard AI SDK demos adapted to use the Electric Durable stream transport:

- `next-openai-app` -- Vercel AI SDK + Next.js + OpenAI demo
- `tanstack-react-chat` -- TanStack AI + TanStack Start + OpenAI demo

## Usage

```sh
pnpm i
pnpm build
pnpm backend:up

# In one terminal
pnpm dev:proxy

# In another terminal, run the default demo (next-openai-app)
pnpm dev:demo

# Or specify a demo by name
pnpm dev:demo tanstack-react-chat
```

Then http://localhost:5173

### Demo

Start long generations. Disconnect, reconnect, refresh the page, etc.

## Next steps

- [ ] more adapters, demos
- [ ] server side persistence via protocol-aware proxies
- [ ] patterns for multi-tab, multi-device, multi-user
