
# Electric Transport

Durable stream transport for SSE-based AI apps. Routes chat sessions / LLM requests through Electric for resilience, durability and multi-client sync.

## Goals

- **drop in**: minimal changes to your app
- **resumable**: resume syncing when the network drops
- **durable**: streams are addressable and persistent

## Packages

- `proxy` - protocol agnostic proxy service
  - intercepts requests to the developer's backend API
  - writes messages from the user request to the database (for full history / catch-up)
  - returns `{requestId, shapeUrl, shapeOffset}` for the client to consume the response messages
  - writes messages from the assistant response to the database (in the background)

- `transport` - drop-in transport plugin
  - protocol agnostic `fetchClient`
    - routes requests via the proxy
    - converts shape stream into SSE stream format

XXX what's actually necessary for the protocol support?

=> If the fetch client persists the offset then will `resume: true` just work?
=> What about loading the initial history, can that just work too?