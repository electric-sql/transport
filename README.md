
# Electric Transport

Durable stream transport, proxy and AI SDK adapters.

## Packages

### Durable transport

- `proxy` -- node service that proxies backend API requests via Electric shape streams
- `transport` -- protocol agnostic transport library with proxy-aware fetch client and storage utilities

- `ai-transport` -- Vercel AI SDK adapter
- `tanstack-ai-transport` -- TanStack AI adapter

### Durable sessions

Durable sessions use a TanStack DB collection as the data model. The durable stream is the source of truth, with messages materialized via a dervied live query pipeline.

- `ai-db` -- framework-agnostic client, collections, and materialization

- `react-ai-db` -- React bindings (`useDurableChat` hook)
- `ai-db-proxy` -- HTTP proxy for session management and agent invocation

### Seperation of concerns

The `proxy`, `transport` and `ai-db` packages should be protocol and reactivity framework agnostic.

## How it works

### Transport

#### Resilient transport

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

#### Persistence

Currently message persistence is all handled by the SDK adapters and localStorage.

There's no server-side persistence or specific protocol-aware proxy services.

#### Resumability

1. SDK adapters
  - configure the chat UIs to reconnect with specific headers

2. fetchClient
  - records active generations in localStorage by default
  - looks for headers like `X-Resume-Active-Generation`
  - if present, resumes the active generation when requested

#### Stream protocol

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

### Durable Sessions

See `docs/DurableSessions.md` for details.

## Demos

Standard AI SDK demos adapted to use the Electric Durable transport:

- `vercel-ai-sdk-durable-transport` -- Vercel AI SDK + Durable Transport
- `tanstack-ai-durable-transport` -- TanStack AI + Durable Transport

Standard TanStack AI demo adapted to use TanStack DB and Durable Session:

- `tanstack-ai-durable-session` -- TanStack AI + DB + Durable Session

## Usage

### Transport Demos (Vercel AI SDK, TanStack AI)

These demos use Electric as the durable stream backend:

```sh
pnpm i
pnpm build
pnpm transport-backend:up  # Starts Postgres + Electric on port 3000

# In one terminal
pnpm dev:transport-proxy

# In another terminal, run the default demo (vercel-ai-sdk-durable-transport)
pnpm dev:demo

# Or specify a demo by name
pnpm dev:demo tanstack-ai-durable-transport
```

### Durable Sessions Demo (TanStack AI + TanStack DB)

This demo uses the Durable Streams server:

```sh
pnpm i
pnpm build
pnpm session-backend:up  # Starts Durable Streams server on port 3001

# In one terminal
pnpm dev:session-proxy

# In another terminal
pnpm dev:demo tanstack-ai-durable-session
```

### Backend Services

| Script | Services | Port |
|--------|----------|------|
| `pnpm transport-backend:up` | Postgres + Electric | 3000 |
| `pnpm session-backend:up` | Durable Streams | 3001 |
| `pnpm backend:up` | All services | 3000, 3001 |

### Demo Ports

- `vercel-ai-sdk-durable-transport`: http://localhost:5173
- `tanstack-ai-durable-transport`: http://localhost:5174
- `tanstack-ai-durable-session`: http://localhost:5175

### Demo

Start long generations. Disconnect, reconnect, refresh the page, etc.

With Durable Sessions, you can extend to show multi-user, multi-agent, multi-tab, multi-device etc.
