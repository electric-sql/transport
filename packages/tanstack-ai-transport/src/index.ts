/**
 * @electric-sql/tanstack-ai-transport
 *
 * Durable transport adapter for TanStack AI.
 *
 * This package provides resilient, resumable streaming for TanStack AI chat
 * applications using Electric's durable stream infrastructure.
 *
 * @example
 * ```typescript
 * import { durableTransport } from '@electric-sql/tanstack-ai-transport'
 * import { useChat } from '@tanstack/ai-react'
 * import { useEffect } from 'react'
 *
 * const proxyUrl = process.env.NEXT_PUBLIC_PROXY_URL || 'http://localhost:4000/api'
 *
 * // Create the durable transport outside the component for stable references
 * const { durableSession, initialMessages, clearSession } =
 *   durableTransport('demo-session', { proxyUrl, api: '/api/chat' })
 *
 * function Chat() {
 *   const { messages, sendMessage, setMessages, isLoading } = useChat({
 *     ...durableSession, // Spreads: id, connection, onFinish
 *   })
 *
 *   // Load persisted messages after hydration to avoid SSR mismatch
 *   useEffect(() => {
 *     if (initialMessages.length > 0) {
 *       setMessages(initialMessages)
 *     }
 *   }, [])
 *
 *   return (
 *     // Your chat UI...
 *   )
 * }
 * ```
 *
 * @packageDocumentation
 */

import { fetchServerSentEvents, type UIMessage } from '@tanstack/ai-client'
import {
  clearActiveGeneration,
  clearSession as clearSessionStorage,
  createFetchClient,
  getActiveGeneration,
  getPersistedMessages,
  setPersistedMessages,
  toUUID,
  type FetchClientOptions,
  type StorageOptions,
} from '@electric-sql/transport'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for the fetch client and API endpoint.
 */
export interface TransportOptions extends FetchClientOptions {
  /**
   * API endpoint URL or function returning the URL.
   * @default '/api/chat'
   */
  api?: string | (() => string)

  /**
   * Request credentials mode.
   * @default 'same-origin'
   */
  credentials?: RequestCredentials
}

/**
 * Options for configuring durable transport behavior.
 */
export interface DurableOptions {
  /**
   * Storage options for active generation resumption.
   * Controls how long a generation can be resumed after disconnect/refresh.
   * @default { ttlMs: 3600000 } // 1 hour
   */
  activeGeneration?: StorageOptions

  /**
   * Storage options for message persistence.
   * Controls how long messages are retained in localStorage.
   * @default { ttlMs: 604800000 } // 7 days
   */
  messages?: StorageOptions

  /**
   * Optional user callback when a message stream finishes.
   * Called after internal persistence logic completes.
   */
  onFinish?: (message: UIMessage) => void
}

/**
 * The session configuration object that can be spread into useChat().
 * Mirrors the pattern from @electric-sql/ai-transport for Vercel AI SDK.
 */
export interface DurableSession {
  /**
   * Unique identifier for this chat session.
   */
  id: string

  /**
   * The connection adapter configured with session-aware headers
   * and custom fetch client that routes through the proxy.
   */
  connection: ReturnType<typeof fetchServerSentEvents>

  /**
   * Callback that persists messages to localStorage on completion
   * and clears the active generation flag.
   */
  onFinish: (message: UIMessage) => void
}

/**
 * The result of durableTransport() containing both the config for
 * useChat() and the initial messages to be loaded after hydration.
 */
export interface DurableTransportResult {
  /**
   * Configuration object to spread into useChat().
   *
   * @example
   * ```typescript
   * const { messages } = useChat({
   *   ...durableSession,
   * })
   * ```
   */
  durableSession: DurableSession

  /**
   * Initial messages loaded from localStorage persistence.
   * Apply these after hydration to avoid SSR mismatches:
   *
   * @example
   * ```typescript
   * useEffect(() => {
   *   if (initialMessages.length > 0) {
   *     setMessages(initialMessages)
   *   }
   * }, [])
   * ```
   */
  initialMessages: UIMessage[]

  /**
   * Clear all persisted data for this session.
   * Removes both active generation state and persisted messages.
   */
  clearSession: () => void
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Create a durable transport for TanStack AI.
 *
 * This function sets up resilient, resumable streaming by routing chat requests
 * through the Electric proxy. It provides:
 *
 * - **Automatic resumption**: On page reload, checks for active generations
 *   and resumes from where the stream left off
 * - **Message persistence**: Saves conversation history to localStorage
 * - **Session management**: Tracks session state for multi-request consistency
 *
 * @param sessionId - Unique identifier for this chat session
 * @param transportOptions - Configuration for the fetch client and proxy
 * @param durableOptions - Optional durable transport configuration
 * @returns Transport configuration and utilities for TanStack AI
 *
 * @example
 * ```typescript
 * import { durableTransport } from '@electric-sql/tanstack-ai-transport'
 * import { useChat } from '@tanstack/ai-react'
 *
 * const { durableSession, initialMessages, clearSession } =
 *   durableTransport('my-session', {
 *     proxyUrl: 'http://localhost:4000/api',
 *     api: '/api/chat',
 *   })
 *
 * function Chat() {
 *   const { messages, sendMessage, setMessages } = useChat({
 *     ...durableSession, // Spreads: id, connection, onFinish
 *   })
 *
 *   // Load persisted messages after hydration
 *   useEffect(() => {
 *     if (initialMessages.length > 0) {
 *       setMessages(initialMessages)
 *     }
 *   }, [])
 *
 *   // ...
 * }
 * ```
 */
export function durableTransport(
  sessionId: string,
  transportOptions: TransportOptions,
  durableOptions: DurableOptions = {}
): DurableTransportResult {
  const {
    activeGeneration: activeGenOpts = {},
    messages: messagesOpts = {},
    onFinish: userOnFinish,
  } = durableOptions

  // Create the durable fetch client that routes through the proxy
  const fetchClient = createFetchClient({
    proxyUrl: transportOptions.proxyUrl,
    auth: transportOptions.auth,
  })

  // Load persisted messages synchronously from localStorage.
  // Returns [] on the server where localStorage is undefined.
  const initialMessages = getPersistedMessages<UIMessage>(
    sessionId,
    messagesOpts.ttlMs
  )

  // Check for active generation to resume
  const activeGen = getActiveGeneration(sessionId, activeGenOpts.ttlMs)
  const sessionIdUUID = toUUID(sessionId)

  // Build headers - include resume headers if there's an active generation
  const getHeaders = () => {
    const headers: Record<string, string> = {
      'X-Session-ID': sessionIdUUID,
    }
    if (activeGen !== null) {
      headers['X-Resume-Active-Generation'] = 'true'
      headers['X-Replay-From-Start'] = 'true'
    }
    return headers
  }

  // Use TanStack AI's fetchServerSentEvents with our custom fetch
  const connection = fetchServerSentEvents(
    transportOptions.api ?? '/api/chat',
    () => ({
      fetchClient,
      headers: getHeaders(),
      credentials: transportOptions.credentials
    })
  )

  // Build onFinish callback with persistence
  const onFinish = (message: UIMessage) => {
    const existing = getPersistedMessages<UIMessage>(
      sessionId,
      messagesOpts.ttlMs
    )
    setPersistedMessages(sessionId, [...existing, message])
    clearActiveGeneration(sessionId)
    userOnFinish?.(message)
  }

  return {
    durableSession: {
      id: sessionId,
      connection,
      onFinish,
    },
    initialMessages,
    clearSession: () => clearSessionStorage(sessionId),
  }
}

// ============================================================================
// Re-exports
// ============================================================================

export {
  clearPersistedMessages,
  clearSession,
  getPersistedMessages,
  setPersistedMessages,
  type StorageOptions,
} from '@electric-sql/transport'
