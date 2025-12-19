/**
 * useDurableChat - React hook for durable chat.
 *
 * Provides TanStack AI-compatible API backed by Durable Streams
 * with automatic React integration.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { DurableChatClient } from '@electric-sql/ai-db'
import type { DurableChatClientOptions } from '@electric-sql/ai-db'
import type { UIMessage, AnyClientTool } from '@tanstack/ai'
import type { UseDurableChatOptions, UseDurableChatReturn } from './types'

/**
 * React hook for durable chat with TanStack AI-compatible API.
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
 *   // collections is always defined - use directly with useLiveQuery
 *   const chunks = useLiveQuery(q => q.from({ row: collections.chunks }), [collections.chunks])
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

  // Reactive state - must be declared first (before client creation uses them)
  const [messages, setMessages] = useState<UIMessage[]>(options.initialMessages ?? [])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | undefined>()
  const [connectionStatus, setConnectionStatus] = useState<
    'disconnected' | 'connecting' | 'connected' | 'error'
  >('disconnected')

  // Error handler ref - allows client's onError to call setError
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

  // Side effects: connect, subscribe, cleanup
  useEffect(() => {
    const unsubscribes: Array<{ unsubscribe: () => void }> = []

    // Subscribe to collection changes
    const collections = client.collections
    unsubscribes.push(
      collections.activeGenerations.subscribeChanges(() => {
        setIsLoading(client.isLoading)
      }),
      collections.messages.subscribeChanges(() => {
        setMessages(client.messages as UIMessage[])
      }),
      collections.sessionMeta.subscribeChanges(() => {
        setConnectionStatus(client.connectionStatus)
      })
    )

    // Sync initial state
    setMessages(client.messages as UIMessage[])
    setIsLoading(client.isLoading)
    setConnectionStatus(client.connectionStatus)

    // Auto-connect if enabled and not already connected
    if (autoConnect && client.connectionStatus === 'disconnected') {
      setConnectionStatus('connecting')
      client
        .connect()
        .then(() => {
          setConnectionStatus('connected')
          setMessages(client.messages as UIMessage[])
        })
        .catch((err) => {
          setConnectionStatus('error')
          setError(err)
        })
    }

    // Cleanup: unsubscribe (disposal happens on key change or unmount via ref logic)
    return () => {
      unsubscribes.forEach((u) => u.unsubscribe())
      // Only dispose if this is not a provided client
      if (!providedClient) {
        client.dispose()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, autoConnect])

  // Callbacks - client is always defined, no null checks needed
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
    setMessages([])
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
    setConnectionStatus('connecting')
    try {
      await client.connect()
      setConnectionStatus('connected')
      setMessages(client.messages as UIMessage[])
    } catch (err) {
      setConnectionStatus('error')
      setError(err instanceof Error ? err : new Error(String(err)))
      throw err
    }
  }, [client])

  const disconnect = useCallback(() => {
    client.disconnect()
    setConnectionStatus('disconnected')
  }, [client])

  const pause = useCallback(() => {
    client.pause()
  }, [client])

  const resume = useCallback(async () => {
    await client.resume()
  }, [client])

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
