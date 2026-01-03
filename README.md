<picture>
  <source media="(prefers-color-scheme: dark)"
      srcset="https://raw.githubusercontent.com/durable-streams/durable-streams/main/docs/img/icon-128.png"
  />
  <source media="(prefers-color-scheme: light)"
      srcset="https://raw.githubusercontent.com/durable-streams/durable-streams/main/docs/img/icon-128.black.png"
  />
  <img alt="Memento polaroid icon"
      src="https://raw.githubusercontent.com/durable-streams/durable-streams/main/docs/img/icon-128.png"
      width="64"
      height="64"
  />
</picture>

# Durable Transport &amp; Durable Session

[Durable Streams](https://github.com/durable-streams/durable-streams) based durable transport and session implementations for [TanStack AI](https://tanstack.com/ai) and the [Vercel AI SDK](https://ai-sdk.dev).

See the [Durable Sessions — the key pattern for collaborative AI](https://electric-sql.com/blog/2026/01/05/durable-sessions-for-collaborative-ai) blog post for more information.

## Durable Transport

Durable Transport plugins integrate at the pluggable [Transport](https://ai-sdk.dev/docs/ai-sdk-ui/transport) / [Connection Adapter](https://tanstack.com/ai/latest/docs/guides/connection-adapters) level to provide resilience and resumability.

SDK-agnostic packages:

- [`@durable-streams/transport`](./packages/transport) &mdash; protocol-agnostic transport library with proxy-aware fetch client and storage utilities
- [`@durable-streams/transport-proxy`](./packages/proxy) &mdash; node service that proxies backend API requests via Durable Streams

SDK-specific adapters:

- [`@durable-streams/tanstack-ai-transport`](./packages/tanstack-ai-transport) &mdash; TanStack AI [Connection Adapter](https://tanstack.com/ai/latest/docs/guides/connection-adapters)
- [`@durable-streams/ai-transport`](./packages/ai-transport) &mdash; Vercel AI SDK [Transport](https://ai-sdk.dev/docs/ai-sdk-ui/transport)

Demos:

- [TanStack AI Durable Transport demo](./demos/tanstack-ai-durable-transport)
- [Vercel AI SDK Durable Transport demo](./demos/vercel-ai-sdk-durable-transport)

## Durable Session

The Durable Sessions pattern swaps out the request <> response based interaction paradigm of the AI SDKs for a sync-based pattern based on [TanStack DB](https://tanstack.com/db). Persistence and addressability is provided by a Durable Stream, using the [`@durable-streams/state`](https://github.com/durable-streams/durable-streams/tree/main/packages/state) protocol.

The Durable Stream provides persistence and addressability. The sync-based architecture naturally supports multi-tab, multi-device and multi-user. The session supports multi-agent and real-time presence.

You can use this pattern to build [genuinely collaborative AI apps](https://electric-sql.com/blog/2026/01/05/durable-sessions-for-collaborative-ai) that support both real-time and asynchronous collaboration. Everything is reactive and type-safe, with zero changes to your actual AI engineering code.

Packages:

- [`@electric-sql/durable-session`](./packages/durable-session) &mdash; core session implementation with `DurableChat` implementation
- [`@electric-sql/durable-session-proxy`](./packages/durable-session-proxy) &mdash; session proxy service
- [`@electric-sql/react-durable-session`](./packages/react-durable-session) &mdash; React bindings (`useDurableChat` hook)

Demo:

- [TanStack AI Durable Session demo](./demos/tanstack-ai-durable-session)

## Usage

```sh
pnpm i
pnpm build
pnpm test

# In one terminal
pnpm backend:up  # Starts Durable Streams server on port 3001
pnpm dev:session-proxy # Starts session proxy for session demo
# pnpm dev:proxy # for transport demos

# In another terminal
pnpm dev:demo tanstack-ai-durable-session
# pnpm dev:demo tanstack-ai-durable-transport
# pnpm dev:demo vercel-ai-sdk-durable-transport
```

## Caveats

Some dependencies are still currently workspace dependencies. See `pnpm-workspace.yaml` for details.
