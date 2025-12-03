import {
  DefaultChatTransport,
  type ChatTransport,
  type HttpChatTransportInitOptions,
  type PrepareReconnectToStreamRequest,
  type PrepareSendMessagesRequest,
  type UIMessage
} from 'ai'

import {
  clearActiveGeneration,
  createFetchClient,
  getPersistedMessages,
  setPersistedMessages,
  toUUID,
  type FetchClientOptions,
  type StorageOptions
} from '@electric-sql/transport'

// Options for configuring the durable transport behavior.
export type DurableOptions<UI_MESSAGE extends UIMessage = UIMessage> = {
  // Storage options for active generation resumption (default TTL: 1 hour).
  // Controls how long a generation can be resumed after page refresh.
  activeGeneration?: StorageOptions

  // Storage options for message persistence (default TTL: 7 days).
  messages?: StorageOptions

  // Optional user-provided onFinish callback that will be called after
  // the internal persistence logic completes.
  onFinish?: OnFinishCallback<UI_MESSAGE>
}

// The callback signature for onFinish, matching the AI SDK's expectations.
export type OnFinishCallback<UI_MESSAGE extends UIMessage = UIMessage> = (
  options: OnFinishOptions<UI_MESSAGE>
) => void

// Options passed to the onFinish callback.
export type OnFinishOptions<UI_MESSAGE extends UIMessage = UIMessage> = {
  message: UI_MESSAGE
  messages: UI_MESSAGE[]
  isAbort: boolean
  isDisconnect: boolean
  isError: boolean
  finishReason?:
    | 'stop'
    | 'length'
    | 'content-filter'
    | 'tool-calls'
    | 'error'
    | 'other'
    | 'unknown'
}

// The configuration object that can be spread into useChat() options.
// Does NOT include messages to avoid hydration mismatches.
export type DurableSession<UI_MESSAGE extends UIMessage = UIMessage> = {
  // Unique identifier for this chat session.
  id: string

  // The durable transport configured with session-aware headers and
  // custom fetch client that routes through the proxy.
  transport: ChatTransport<UI_MESSAGE>

  // Always true - enables stream resumption on page reload.
  resume: true

  // Callback that persists messages to localStorage on completion
  // and clears the active generation flag.
  onFinish: OnFinishCallback<UI_MESSAGE>
}

// The result of durableTransport() containing both the config for
// useChat() and the initial messages to be loaded after hydration.
export type DurableTransport<UI_MESSAGE extends UIMessage = UIMessage> = {
  // Configuration object to spread into useChat().
  durableSession: DurableSession<UI_MESSAGE>

  // Initial messages loaded from localStorage persistence.
  initialMessages: UI_MESSAGE[]
}

/**
 * Create a durable session configuration for use with useChat().
 *
 * Returns a config object (to spread into useChat) and initialMessages
 * (to apply via setMessages in useEffect). This two-step pattern avoids
 * React hydration mismatches caused by localStorage being unavailable
 * during server-side rendering.
 *
 * @example
 * ```typescript
 * const { durableSession, initialMessages } = durableTransport(
 *   'my-session',
 *   { proxyUrl },
 *   { api: '/api/chat' }
 * )
 *
 * const { messages, setMessages, sendMessage, ... } = useChat({...durableSession})
 *
 * useEffect(() => {
 *   if (initialMessages.length > 0) {
 *     setMessages(initialMessages)
 *   }
 * }, [])
 * ```
 *
 * @param sessionId - Unique identifier for the chat session. Used for:
 *   - Routing requests through the proxy
 *   - Persisting messages in localStorage
 *   - Tracking active generation state
 *
 * @param fetchOptions - Configuration for the fetch client:
 *   - proxyUrl: URL of the durable proxy server
 *   - auth: Optional authentication headers
 *
 * @param transportOptions - Configuration for the DefaultChatTransport:
 *   - api: The API endpoint path (e.g., '/api/chat')
 *   - Other HttpChatTransportInitOptions
 *
 * @param durableOptions - Optional durable-specific configuration:
 *   - activeGeneration: { ttlMs } for resumable generations (default: 1 hour)
 *   - messages: { ttlMs } for message persistence (default: 7 days)
 *   - onFinish: User callback called after persistence
 */
export function durableTransport<UI_MESSAGE extends UIMessage = UIMessage>(
  sessionId: string,
  fetchOptions: FetchClientOptions,
  transportOptions: HttpChatTransportInitOptions<UI_MESSAGE>,
  durableOptions: DurableOptions<UI_MESSAGE> = {}
): DurableTransport<UI_MESSAGE> {
  const {
    activeGeneration = {},
    messages = {},
    onFinish: userOnFinish
  } = durableOptions

  // Create the custom fetch client that routes through the proxy
  const fetch = createFetchClient(fetchOptions)

  // Load persisted messages synchronously from localStorage.
  // This returns [] on the server (where localStorage is undefined).
  const initialMessages = getPersistedMessages<UI_MESSAGE>(
    sessionId,
    messages.ttlMs
  )

  // Build the transport with session-aware request preparation
  const transport = buildTransport<UI_MESSAGE>(
    sessionId,
    fetch,
    transportOptions,
    activeGeneration.ttlMs
  )

  // Create the onFinish callback that handles persistence
  const onFinish = buildOnFinishCallback<UI_MESSAGE>(sessionId, userOnFinish)

  return {
    durableSession: {
      id: sessionId,
      transport,
      resume: true,
      onFinish
    },
    initialMessages
  }
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Build the DefaultChatTransport with session-aware request preparation.
 */
function buildTransport<UI_MESSAGE extends UIMessage>(
  sessionId: string,
  fetch: typeof globalThis.fetch,
  transportOptions: HttpChatTransportInitOptions<UI_MESSAGE>,
  activeGenerationTtlMs?: number
): ChatTransport<UI_MESSAGE> {
  const prepareReconnectToStreamRequest: PrepareReconnectToStreamRequest = (
    opts
  ) => {
    const headers = normalizeHeaders(opts.headers)
    headers.set('X-Session-ID', toUUID(sessionId))
    headers.set('X-Resume-Active-Generation', 'true')
    // The AI SDK needs complete message reconstruction on page reload,
    // so we request the stream to replay from the beginning.
    headers.set('X-Replay-From-Start', 'true')

    // Pass TTL via header so fetch client can use it for storage lookup
    if (activeGenerationTtlMs !== undefined) {
      headers.set('X-Active-Generation-TTL', String(activeGenerationTtlMs))
    }

    const original = transportOptions.prepareReconnectToStreamRequest

    return original !== undefined
      ? original({ ...opts, headers })
      : { headers, credentials: opts.credentials, api: opts.api }
  }

  const prepareSendMessagesRequest: PrepareSendMessagesRequest<UI_MESSAGE> = (
    opts
  ) => {
    const headers = normalizeHeaders(opts.headers)
    headers.set('X-Session-ID', toUUID(sessionId))

    setPersistedMessages(sessionId, opts.messages)

    const original = transportOptions.prepareSendMessagesRequest

    if (original !== undefined) {
      return original({ ...opts, headers })
    }

    const body = {
      ...opts.body,
      id: opts.id,
      messages: opts.messages,
      trigger: opts.trigger,
      messageId: opts.messageId
    }

    return { body, headers, credentials: opts.credentials, api: opts.api }
  }

  return new DefaultChatTransport({
    ...transportOptions,
    fetch,
    prepareReconnectToStreamRequest,
    prepareSendMessagesRequest
  })
}

/**
 * Build the onFinish callback that persists messages and clears active generation.
 */
function buildOnFinishCallback<UI_MESSAGE extends UIMessage>(
  sessionId: string,
  userOnFinish?: OnFinishCallback<UI_MESSAGE>
): OnFinishCallback<UI_MESSAGE> {
  return (options: OnFinishOptions<UI_MESSAGE>) => {
    // Persist the complete message history to localStorage
    setPersistedMessages(sessionId, options.messages)

    // Clear the active generation flag since we're done
    clearActiveGeneration(sessionId)

    // Call the user's onFinish callback if provided
    userOnFinish?.(options)
  }
}

/**
 * Normalize headers to a Headers instance.
 */
function normalizeHeaders(headers: HeadersInit | undefined): Headers {
  if (headers instanceof Headers) {
    return headers
  }

  return new Headers(headers)
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

// Re-export storage utilities for advanced use cases
export {
  clearPersistedMessages,
  clearSession,
  type StorageOptions
} from '@electric-sql/transport'
