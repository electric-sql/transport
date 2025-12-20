/**
 * useDurableChat - React hook for durable chat.
 *
 * Provides TanStack AI-compatible API backed by Durable Streams
 * with automatic React integration via TanStack DB's useLiveQuery.
 *
 * This hook is client-only and will return empty/default values during SSR.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import { DurableChatClient, messageRowToUIMessage } from '@electric-sql/ai-db'
import type { DurableChatClientOptions } from '@electric-sql/ai-db'
import type { UIMessage, AnyClientTool } from '@tanstack/ai'
import type { UseDurableChatOptions, UseDurableChatReturn } from './types'

/**
 * Detect if we're running on the server (SSR).
 */
const isServer = typeof window === 'undefined'

/**
 * React hook for durable chat with TanStack AI-compatible API.
 *
 * Uses TanStack DB's useLiveQuery for reactive data binding, providing
 * automatic updates when underlying collection data changes.
 *
 * The client and collections are always available synchronously.
 * Connection state is managed separately via connectionStatus.
 *
 * @example Basic usage
 * ```typescript
 * function Chat() {
 *   const { messages, sendMessage, isLoading, collections } = useDurableChat({
 *     sessionId: 'my-session',
 *     proxyUrl: 'http://localhost:4000',
 *   })
 *
 *   // collections is always defined - use directly with useLiveQuery for custom queries
 *   const toolCalls = useLiveQuery(q =>
 *     q.from({ tc: collections.toolCalls })
 *      .where(({ tc }) => eq(tc.state, 'pending'))
 *   )
 *
 *   return (
 *     <div>
 *       {messages.map(m => <Message key={m.id} message={m} />)}
 *       <Input onSubmit={sendMessage} disabled={isLoading} />
 *     </div>
 *   )
 * }
 * ```
 */
export function useDurableChat<
  TTools extends ReadonlyArray<AnyClientTool> = AnyClientTool[],
>(options: UseDurableChatOptions<TTools>): UseDurableChatReturn<TTools> {
  const { autoConnect = true, client: providedClient, ...clientOptions } = options

  // ═══════════════════════════════════════════════════════════════════════
  // Client Creation (synchronous - always available immediately)
  // ═══════════════════════════════════════════════════════════════════════

  // Error handler ref - allows client's onError to call setError
  const [error, setError] = useState<Error | undefined>()
  const onErrorRef = useRef<(err: Error) => void>(() => {})
  onErrorRef.current = (err) => {
    setError(err)
    clientOptions.onError?.(err)
  }

  // Create client synchronously - always available immediately
  // Use ref to persist across renders and track when we need a new client
  const clientRef = useRef<{ client: DurableChatClient<TTools>; key: string } | null>(null)
  const key = `${clientOptions.sessionId}:${clientOptions.proxyUrl}`

  // Create or recreate client when key changes
  if (providedClient) {
    // Use provided client (for testing)
    if (!clientRef.current || clientRef.current.client !== providedClient) {
      clientRef.current = { client: providedClient, key: 'provided' }
    }
  } else if (!clientRef.current || clientRef.current.key !== key) {
    // Dispose old client if exists
    clientRef.current?.client.dispose()
    // Create new client synchronously
    clientRef.current = {
      client: new DurableChatClient<TTools>({
        ...clientOptions,
        onError: (err) => onErrorRef.current(err),
      } as DurableChatClientOptions<TTools>),
      key,
    }
  }

  const client = clientRef.current.client

  // ═══════════════════════════════════════════════════════════════════════
  // Reactive Data via useLiveQuery
  // ═══════════════════════════════════════════════════════════════════════

  // Subscribe to messages collection - automatically updates when data changes
  // Using callback form for proper type inference with pre-created collections
  const { data: messageRows } = useLiveQuery(() => client.collections.messages)

  // Subscribe to active generations - for isLoading state
  const { data: activeGenerations } = useLiveQuery(() => client.collections.activeGenerations)

  // Subscribe to session metadata - for connection status
  const { data: sessionMetaRows } = useLiveQuery(() => client.collections.sessionMeta)

  // ═══════════════════════════════════════════════════════════════════════
  // Derived State
  // ═══════════════════════════════════════════════════════════════════════

  // Transform MessageRow[] to UIMessage[]
  const messages = useMemo(
    () => (messageRows ?? []).map(messageRowToUIMessage),
    [messageRows]
  )

  // Derive isLoading from activeGenerations collection
  const isLoading = (activeGenerations?.length ?? 0) > 0

  // Derive connectionStatus from sessionMeta collection
  const connectionStatus = sessionMetaRows?.[0]?.connectionStatus ?? 'disconnected'

  // ═══════════════════════════════════════════════════════════════════════
  // Connection Lifecycle
  // ═══════════════════════════════════════════════════════════════════════

  useEffect(() => {
    // Auto-connect if enabled and not already connected
    if (autoConnect && client.connectionStatus === 'disconnected') {
      client.connect().catch((err) => {
        setError(err instanceof Error ? err : new Error(String(err)))
      })
    }

    // Cleanup: dispose client on unmount (only if not provided externally)
    return () => {
      if (!providedClient) {
        client.dispose()
      }
    }
  }, [client, autoConnect, providedClient])

  // ═══════════════════════════════════════════════════════════════════════
  // Action Callbacks
  // ═══════════════════════════════════════════════════════════════════════

  const sendMessage = useCallback(async (content: string) => {
    try {
      await client.sendMessage(content)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
      throw err
    }
  }, [client])

  const append = useCallback(
    async (message: UIMessage | { role: string; content: string }) => {
      try {
        await client.append(message)
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)))
        throw err
      }
    },
    [client]
  )

  const reload = useCallback(async () => {
    try {
      await client.reload()
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
      throw err
    }
  }, [client])

  const stop = useCallback(() => {
    client.stop()
  }, [client])

  const clear = useCallback(() => {
    client.clear()
  }, [client])

  const addToolResult = useCallback(
    async (result: Parameters<DurableChatClient<TTools>['addToolResult']>[0]) => {
      await client.addToolResult(result)
    },
    [client]
  )

  const addToolApprovalResponse = useCallback(
    async (response: Parameters<DurableChatClient<TTools>['addToolApprovalResponse']>[0]) => {
      await client.addToolApprovalResponse(response)
    },
    [client]
  )

  const fork = useCallback(
    async (opts?: Parameters<DurableChatClient<TTools>['fork']>[0]) => {
      return client.fork(opts)
    },
    [client]
  )

  const registerAgents = useCallback(
    async (agents: Parameters<DurableChatClient<TTools>['registerAgents']>[0]) => {
      await client.registerAgents(agents)
    },
    [client]
  )

  const unregisterAgent = useCallback(async (agentId: string) => {
    await client.unregisterAgent(agentId)
  }, [client])

  const connect = useCallback(async () => {
    try {
      await client.connect()
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
      throw err
    }
  }, [client])

  const disconnect = useCallback(() => {
    client.disconnect()
  }, [client])

  const pause = useCallback(() => {
    client.pause()
  }, [client])

  const resume = useCallback(async () => {
    await client.resume()
  }, [client])

  // ═══════════════════════════════════════════════════════════════════════
  // Return Value
  // ═══════════════════════════════════════════════════════════════════════

  return {
    // TanStack AI useChat compatible
    messages,
    sendMessage,
    append,
    reload,
    stop,
    clear,
    isLoading,
    error,
    addToolResult,
    addToolApprovalResponse,

    // Durable extensions
    client,
    collections: client.collections,
    connectionStatus,
    fork,
    registerAgents,
    unregisterAgent,
    connect,
    disconnect,
    pause,
    resume,
  }
}
