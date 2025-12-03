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
 *
 * const proxyUrl = process.env.NEXT_PUBLIC_PROXY_URL || 'http://localhost:4000/api'
 *
 * // Create the durable transport outside the component for stable references
 * const { durableSession, useDurability, clearSession } =
 *   durableTransport('demo-session', { proxyUrl, api: '/api/chat' })
 *
 * function Chat() {
 *   const [chunks, setChunks] = useState<StreamChunk[]>([])
 *
 *   const { messages, sendMessage, setMessages } = useChat({
 *     ...durableSession, // Spreads: id, connection, onFinish
 *     onChunk: (chunk) => setChunks(prev => [...prev, chunk]),
 *   })
 *
 *   // Handle message persistence and active generation resumption
 *   const { isResuming } = useDurability(messages, setMessages, setChunks)
 *
 *   return (
 *     // Your chat UI...
 *   )
 * }
 * ```
 *
 * @packageDocumentation
 */

import { useEffect, useRef, useState } from 'react'
import {
  fetchServerSentEvents,
  type ConnectionAdapter,
  type UIMessage,
} from '@tanstack/ai-client'
import type { StreamChunk } from '@tanstack/ai'
import {
  clearActiveGeneration,
  clearSession as clearSessionStorage,
  createFetchClient,
  getActiveGeneration,
  getPersistedMessages,
  resume as resumeStream,
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
 * Callbacks for handling a resumed stream.
 */
export interface ResumeCallbacks {
  /**
   * The existing assistant message to append to (for resume from offset).
   */
  existingMessage?: UIMessage

  /**
   * Called for each chunk received from the resumed stream.
   */
  onChunk?: (chunk: StreamChunk) => void

  /**
   * Called when the assistant message is updated (for progressive UI updates).
   */
  onMessageUpdate?: (message: UIMessage) => void

  /**
   * Called when the resumed stream completes with the final assistant message.
   */
  onFinish?: (message: UIMessage) => void

  /**
   * Called if an error occurs during stream resumption.
   */
  onError?: (error: Error) => void
}

/**
 * Options for the useDurability hook.
 */
export interface DurabilityOptions {
  /**
   * Additional callback for each chunk received during resumption.
   * Called after the internal setChunks handler.
   */
  onChunk?: (chunk: StreamChunk) => void

  /**
   * Additional callback when resumption completes.
   * Called after the internal setMessages handler.
   */
  onFinish?: (message: UIMessage) => void

  /**
   * Callback if an error occurs during resumption.
   */
  onError?: (error: Error) => void
}

/**
 * Return value from useDurability hook.
 */
export interface DurabilityResult {
  /**
   * Whether an active generation is currently being resumed.
   */
  isResuming: boolean
}

/**
 * The useDurability hook type returned from durableTransport.
 */
export type UseDurabilityHook = (
  messages: UIMessage[],
  setMessages: (
    messages: UIMessage[] | ((prev: UIMessage[]) => UIMessage[])
  ) => void,
  setChunks: (
    chunks: StreamChunk[] | ((prev: StreamChunk[]) => StreamChunk[])
  ) => void,
  options?: DurabilityOptions
) => DurabilityResult

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
   * The connection adapter configured with session-aware headers,
   * custom fetch client that routes through the proxy, and
   * automatic message persistence on each request.
   */
  connection: ConnectionAdapter

  /**
   * Callback that clears the active generation flag on completion.
   */
  onFinish: (message: UIMessage) => void
}

/**
 * The result of durableTransport() containing the config for useChat()
 * and utilities for durability and session management.
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
   * React hook for message persistence and active generation resumption.
   *
   * This hook:
   * - Loads persisted messages from localStorage on mount
   * - Persists messages to localStorage whenever they change
   * - Resumes any active generation that was interrupted (e.g., by page refresh)
   *
   * @example
   * ```typescript
   * const { isResuming } = useDurability(messages, setMessages, setChunks)
   * ```
   *
   * @example With optional callbacks
   * ```typescript
   * const { isResuming } = useDurability(messages, setMessages, setChunks, {
   *   onChunk: (chunk) => console.log('Resumed chunk:', chunk),
   *   onFinish: (message) => console.log('Resumed message:', message),
   *   onError: (error) => console.error('Resume failed:', error),
   * })
   * ```
   */
  useDurability: UseDurabilityHook

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
 * - **Message persistence**: Saves conversation history to localStorage
 * - **Automatic resumption**: On page reload, resumes active generations
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
 * const { durableSession, useDurability, clearSession } =
 *   durableTransport('my-session', {
 *     proxyUrl: 'http://localhost:4000/api',
 *     api: '/api/chat',
 *   })
 *
 * function Chat() {
 *   const [chunks, setChunks] = useState<StreamChunk[]>([])
 *
 *   const { messages, sendMessage, setMessages } = useChat({
 *     ...durableSession,
 *     onChunk: (chunk) => setChunks(prev => [...prev, chunk]),
 *   })
 *
 *   // Handle message persistence and active generation resumption
 *   const { isResuming } = useDurability(messages, setMessages, setChunks)
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
  const { activeGeneration: activeGenOpts = {}, onFinish: userOnFinish } =
    durableOptions

  // Create the durable fetch client that routes through the proxy
  const fetchClient = createFetchClient({
    proxyUrl: transportOptions.proxyUrl,
    auth: transportOptions.auth,
  })

  const sessionIdUUID = toUUID(sessionId)

  // Build headers for normal requests (no resume headers)
  const getHeaders = () => {
    return {
      'X-Session-ID': sessionIdUUID,
    }
  }

  // Create the inner connection using fetchServerSentEvents
  const innerConnection = fetchServerSentEvents(
    transportOptions.api ?? `/api/chat`,
    () => ({
      fetchClient,
      headers: getHeaders(),
      credentials: transportOptions.credentials,
    })
  )

  // Use the inner connection directly
  // Message persistence is handled by useDurability hook
  const connection: ConnectionAdapter = innerConnection

  // Build onFinish callback
  // Note: clearActiveGeneration is handled by stream cleanup in stream.ts
  const onFinish = (message: UIMessage) => {
    userOnFinish?.(message)
  }

  // Build resumeActiveGeneration function
  // Resumes from the stored offset (not from start) and appends to existing message
  const resumeActiveGeneration = async (
    callbacks: ResumeCallbacks = {}
  ): Promise<(() => void) | undefined> => {
    // Re-check for active generation (it may have been cleared)
    // Use sessionIdUUID to match what the proxy/stream uses for storage
    const currentActiveGen = getActiveGeneration(
      sessionIdUUID,
      activeGenOpts.ttlMs
    )
    if (currentActiveGen === null) {
      return undefined
    }

    try {
      // Resume the stream from the stored offset (not from start)
      // This gives us only the NEW chunks we missed
      const streamResult = await resumeStream(currentActiveGen, {
        replayFromStart: false,
      })

      const { dataStream, controlStream, cleanup } = streamResult

      // Create or reuse the assistant message
      // IMPORTANT: Deep copy parts to avoid mutating shared objects in React state
      const assistantMessage: UIMessage = callbacks.existingMessage
        ? {
            ...callbacks.existingMessage,
            parts: callbacks.existingMessage.parts.map((p) => ({ ...p })),
          }
        : {
            id: `resumed-${Date.now()}`,
            role: `assistant`,
            parts: [],
            createdAt: new Date(),
          }

      // Create an async generator that reads from the resumed stream
      const resumedStreamGenerator =
        async function* (): AsyncGenerator<StreamChunk> {
          let buffer = ``

          // Subscribe to the data stream
          const chunks: string[] = []
          let resolveChunk: ((value: string | null) => void) | null = null
          let done = false

          const dataUnsubscribe = dataStream.subscribe((messages) => {
            for (const msg of messages) {
              if (`control` in msg.headers) continue
              const row = (msg as { value: Record<string, unknown> }).value
              if (row?.data) {
                chunks.push(row.data as string)
                resolveChunk?.(row.data as string)
              }
            }
          })

          const controlUnsubscribe = controlStream.subscribe((messages) => {
            for (const msg of messages) {
              if (`control` in msg.headers) continue
              const row = (msg as { value: Record<string, unknown> }).value
              if (row?.event === `done` || row?.event === `error`) {
                done = true
                resolveChunk?.(null)
              }
            }
          })

          try {
            while (!done) {
              // Check for already buffered chunks
              if (chunks.length > 0) {
                const chunk = chunks.shift()!
                buffer += chunk
              } else {
                // Wait for next chunk
                const chunk = await new Promise<string | null>((resolve) => {
                  resolveChunk = resolve
                })
                if (chunk === null) break
                buffer += chunk
              }

              // Parse SSE format and yield chunks
              const lines = buffer.split(`\n`)
              buffer = lines.pop() || ``

              for (const line of lines) {
                const trimmed = line.trim()
                if (!trimmed) continue
                const data = trimmed.startsWith(`data: `)
                  ? trimmed.slice(6)
                  : trimmed
                if (data === `[DONE]`) continue
                try {
                  const parsed: StreamChunk = JSON.parse(data)
                  yield parsed
                } catch {
                  // Skip malformed chunks
                }
              }
            }

            // Process remaining buffer
            if (buffer.trim()) {
              const data = buffer.startsWith(`data: `)
                ? buffer.slice(6)
                : buffer
              if (data !== `[DONE]`) {
                try {
                  const parsed: StreamChunk = JSON.parse(data)
                  yield parsed
                } catch {
                  // Skip malformed chunks
                }
              }
            }
          } finally {
            dataUnsubscribe()
            controlUnsubscribe()
          }
        }

      // Process chunks directly (no StreamProcessor needed for simple text accumulation)
      for await (const chunk of resumedStreamGenerator()) {
        callbacks.onChunk?.(chunk)

        // Handle text/content chunks - update message with the content
        // NOTE: chunk.content from TanStack AI is CUMULATIVE (contains full text so far),
        // not a delta. We should NOT accumulate it - just use it directly.
        if (chunk.type === `content` && `content` in chunk && chunk.content) {
          // Use chunk.content directly as it's cumulative from the API
          const newText = chunk.content

          // Update the assistant message text part
          // IMPORTANT: Create new part object instead of mutating to respect React immutability
          const textPartIndex = assistantMessage.parts.findIndex(
            (p) => p.type === `text`
          )
          if (textPartIndex >= 0) {
            // Create a NEW part object instead of mutating the existing one
            assistantMessage.parts[textPartIndex] = {
              type: `text`,
              content: newText,
            }
          } else {
            assistantMessage.parts.push({ type: `text`, content: newText })
          }

          // Notify about the message update for progressive UI
          // Create fresh copies of message and parts array for React
          callbacks.onMessageUpdate?.({
            ...assistantMessage,
            parts: assistantMessage.parts.map((p) => ({ ...p })),
          })
        }
      }

      // Call onFinish with a fresh copy of the final message for React
      callbacks.onFinish?.({
        ...assistantMessage,
        parts: assistantMessage.parts.map((p) => ({ ...p })),
      })
      // Use sessionIdUUID to match what the proxy/stream uses for storage
      clearActiveGeneration(sessionIdUUID)

      return cleanup
    } catch (error) {
      callbacks.onError?.(
        error instanceof Error ? error : new Error(String(error))
      )
      return undefined
    }
  }

  // Create the useDurability hook that captures session config
  const useDurability: UseDurabilityHook = (
    messages,
    setMessages,
    setChunks,
    options = {}
  ) => {
    const [isResuming, setIsResuming] = useState(false)
    const hasInitializedRef = useRef(false)

    // Load persisted messages AND resume active generation on mount
    // Combined into a single effect to avoid React state timing issues
    useEffect(() => {
      if (hasInitializedRef.current) return
      hasInitializedRef.current = true

      // Step 1: Load persisted messages from localStorage
      const persisted = getPersistedMessages<UIMessage>(
        sessionIdUUID,
        durableOptions.messages?.ttlMs
      )

      if (persisted.length > 0) {
        setMessages(persisted)
      }

      // Step 2: Check for active generation to resume
      const currentActiveGen = getActiveGeneration(
        sessionIdUUID,
        activeGenOpts.ttlMs
      )
      if (currentActiveGen === null) return

      // Step 3: Find the existing assistant message from the PERSISTED data (not React state)
      // This avoids the timing issue where React state hasn't updated yet
      const existingAssistantMessage =
        persisted.length > 0 &&
        persisted[persisted.length - 1]?.role === `assistant`
          ? persisted[persisted.length - 1]
          : undefined

      setIsResuming(true)

      resumeActiveGeneration({
        existingMessage: existingAssistantMessage,
        onChunk: (chunk) => {
          setChunks((prev) => [...prev, chunk])
          options.onChunk?.(chunk)
        },
        onMessageUpdate: (message) => {
          // Replace the last assistant message with the updated one
          setMessages((prev) => {
            if (
              prev.length > 0 &&
              prev[prev.length - 1]?.role === `assistant`
            ) {
              return [...prev.slice(0, -1), message]
            }
            return [...prev, message]
          })
        },
        onFinish: (message) => {
          // Final update - replace the last assistant message
          setMessages((prev) => {
            if (
              prev.length > 0 &&
              prev[prev.length - 1]?.role === `assistant`
            ) {
              return [...prev.slice(0, -1), message]
            }
            return [...prev, message]
          })
          setIsResuming(false)
          options.onFinish?.(message)
        },
        onError: (error) => {
          setIsResuming(false)
          options.onError?.(error)
        },
      })
    }, [
      setMessages,
      setChunks,
      options.onChunk,
      options.onFinish,
      options.onError,
    ])

    // Persist messages whenever they change (after initial load)
    useEffect(() => {
      if (!hasInitializedRef.current) return
      // Use sessionIdUUID for consistent storage keying
      setPersistedMessages(sessionIdUUID, messages)
    }, [messages])

    return { isResuming }
  }

  return {
    durableSession: {
      id: sessionId,
      connection,
      onFinish,
    },
    useDurability,
    // Use sessionIdUUID for consistent storage keying
    clearSession: () => clearSessionStorage(sessionIdUUID),
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
