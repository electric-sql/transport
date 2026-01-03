
# Durable Streams Transport

Durable stream transport, proxy and AI SDK adapters.

## Packages

### Durable Transport

- `transport` -- protocol-agnostic transport library with proxy-aware fetch client and storage utilities
- `proxy` -- node service that proxies backend API requests via Durable Streams

- `ai-transport` -- Vercel AI SDK adapter
- `tanstack-ai-transport` -- TanStack AI adapter

### Durable Sessions

Durable sessions use a TanStack DB collection as the data model. The durable stream is the source of truth, with messages materialized via a derived live query pipeline.

- `@electric-sql/durable-session` -- framework-agnostic client, collections, and materialization
- `@electric-sql/react-durable-session` -- React bindings (`useDurableChat` hook)
- `@electric-sql/durable-session-proxy` -- HTTP proxy for session management and agent invocation

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
  - writes the response to a Durable Stream as JSON events
  - sends back stream urls to the fetchClient

4. fetchClient
  - consumes the Durable Stream
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

#### Stream Protocol

The transport layer uses Durable Streams with a single-stream JSON event protocol:

**Event Types**:
```typescript
// Data chunk (wraps raw SSE from upstream API)
{ type: "data", payload: string }

// Stream completed successfully
{ type: "done", finishReason: string }

// Stream error
{ type: "error", message: string }
```

**Stream URL Pattern**:
```
{durableStreamsUrl}/stream/{sessionId}/{requestId}
```

**Resumption**:
- Client stores stream URL and offset in localStorage
- On reconnect, resumes from stored offset (or replays from start for page reload)
- Single offset value (replaces the previous dual-stream handle + offset pattern)

### Durable Sessions

See `docs/DurableSessions.md` for details.

## Demos

Standard AI SDK demos adapted to use Durable Streams transport:

- `vercel-ai-sdk-durable-transport` -- Vercel AI SDK + Durable Transport
- `tanstack-ai-durable-transport` -- TanStack AI + Durable Transport

Standard TanStack AI demo adapted to use TanStack DB and Durable Session:

- `tanstack-ai-durable-session` -- TanStack AI + DB + Durable Session

## Usage

### Transport Demos (Vercel AI SDK, TanStack AI)

These demos use Durable Streams as the backend:

```sh
pnpm i
pnpm build
pnpm backend:up  # Starts Durable Streams server on port 3001

# In one terminal
pnpm dev:proxy

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
pnpm backend:up  # Starts Durable Streams server on port 3001

# In one terminal
pnpm dev:session-proxy

# In another terminal
pnpm dev:demo tanstack-ai-durable-session
```

### Backend Services

| Script | Services | Port |
|--------|----------|------|
| `pnpm backend:up` | Durable Streams | 3001 |

### Demo Ports

- `vercel-ai-sdk-durable-transport`: http://localhost:5173
- `tanstack-ai-durable-transport`: http://localhost:5174
- `tanstack-ai-durable-session`: http://localhost:5175

### Demo

Start long generations. Disconnect, reconnect, refresh the page, etc.

With Durable Sessions, you can extend to show multi-user, multi-agent, multi-tab, multi-device etc.
