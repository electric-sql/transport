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
 * @example Basic usage
 * ```typescript
 * function Chat() {
 *   const { messages, sendMessage, isLoading } = useDurableChat({
 *     sessionId: 'my-session',
 *     proxyUrl: 'http://localhost:4000',
 *   })
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

  // Core state
  const [messages, setMessages] = useState<UIMessage[]>(options.initialMessages ?? [])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | undefined>()
  const [connectionStatus, setConnectionStatus] = useState<
    'disconnected' | 'connecting' | 'connected' | 'error'
  >('disconnected')

  // Client state - null until effect creates it
  const [client, setClient] = useState<DurableChatClient<TTools> | null>(
    providedClient ?? null
  )

  // Create and manage client lifecycle in useEffect (where side effects belong)
  useEffect(() => {
    let activeClient: DurableChatClient<TTools>
    let shouldDisposeOnCleanup = false

    // If a client was provided externally, use it (for testing)
    if (providedClient) {
      activeClient = providedClient
      setClient(providedClient)
    } else {
      // Create the client (side effect - belongs in useEffect)
      activeClient = new DurableChatClient<TTools>({
        ...clientOptions,
        onError: (err) => {
          setError(err)
          clientOptions.onError?.(err)
        },
      } as DurableChatClientOptions<TTools>)

      setClient(activeClient)
      shouldDisposeOnCleanup = true

      // Reset state for new client
      setMessages([])
      setIsLoading(false)
      setError(undefined)
      setConnectionStatus('disconnected')

      // Auto-connect if enabled
      if (autoConnect) {
        setConnectionStatus('connecting')
        activeClient
          .connect()
          .then(() => {
            setConnectionStatus('connected')
            setMessages(activeClient.messages as UIMessage[])
          })
          .catch((err) => {
            setConnectionStatus('error')
            setError(err)
          })
      }
    }

    // Subscribe to collection changes (for both provided and created clients)
    const unsubscribes = [
      activeClient.collections.activeGenerations.subscribeChanges(() => {
        setIsLoading(activeClient.isLoading)
      }),
      activeClient.collections.messages.subscribeChanges((changes) => {
        setMessages(activeClient.messages as UIMessage[])
      }),
      activeClient.collections.sessionMeta.subscribeChanges(() => {
        setConnectionStatus(activeClient.connectionStatus)
      }),
    ]

    // Cleanup: unsubscribe and optionally dispose client
    // In Strict Mode: this runs before the second mount, cleaning up the first client
    return () => {
      unsubscribes.forEach((u) => u.unsubscribe())
      if (shouldDisposeOnCleanup) {
        activeClient.dispose()
      }
    }
    // Only recreate client when session or proxy changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providedClient, clientOptions.sessionId, clientOptions.proxyUrl, autoConnect])

  // Stable callback refs - avoid recreating on every client change
  const clientRef = useRef(client)
  clientRef.current = client

  const sendMessage = useCallback(async (content: string) => {
    const c = clientRef.current
    if (!c) throw new Error('Client not initialized')
    try {
      await c.sendMessage(content)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
      throw err
    }
  }, [])

  const append = useCallback(
    async (message: UIMessage | { role: string; content: string }) => {
      const c = clientRef.current
      if (!c) throw new Error('Client not initialized')
      try {
        await c.append(message)
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)))
        throw err
      }
    },
    []
  )

  const reload = useCallback(async () => {
    const c = clientRef.current
    if (!c) throw new Error('Client not initialized')
    try {
      await c.reload()
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
      throw err
    }
  }, [])

  const stop = useCallback(() => {
    clientRef.current?.stop()
  }, [])

  const clear = useCallback(() => {
    clientRef.current?.clear()
    setMessages([])
  }, [])

  const addToolResult = useCallback(
    async (result: Parameters<DurableChatClient<TTools>['addToolResult']>[0]) => {
      const c = clientRef.current
      if (!c) throw new Error('Client not initialized')
      await c.addToolResult(result)
    },
    []
  )

  const addToolApprovalResponse = useCallback(
    async (response: Parameters<DurableChatClient<TTools>['addToolApprovalResponse']>[0]) => {
      const c = clientRef.current
      if (!c) throw new Error('Client not initialized')
      await c.addToolApprovalResponse(response)
    },
    []
  )

  const fork = useCallback(
    async (opts?: Parameters<DurableChatClient<TTools>['fork']>[0]) => {
      const c = clientRef.current
      if (!c) throw new Error('Client not initialized')
      return c.fork(opts)
    },
    []
  )

  const registerAgents = useCallback(
    async (agents: Parameters<DurableChatClient<TTools>['registerAgents']>[0]) => {
      const c = clientRef.current
      if (!c) throw new Error('Client not initialized')
      await c.registerAgents(agents)
    },
    []
  )

  const unregisterAgent = useCallback(async (agentId: string) => {
    const c = clientRef.current
    if (!c) throw new Error('Client not initialized')
    await c.unregisterAgent(agentId)
  }, [])

  const connect = useCallback(async () => {
    const c = clientRef.current
    if (!c) throw new Error('Client not initialized')
    setConnectionStatus('connecting')
    try {
      await c.connect()
      setConnectionStatus('connected')
      setMessages(c.messages as UIMessage[])
    } catch (err) {
      setConnectionStatus('error')
      setError(err instanceof Error ? err : new Error(String(err)))
      throw err
    }
  }, [])

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect()
    setConnectionStatus('disconnected')
  }, [])

  const pause = useCallback(() => {
    clientRef.current?.pause()
  }, [])

  const resume = useCallback(async () => {
    const c = clientRef.current
    if (!c) throw new Error('Client not initialized')
    await c.resume()
  }, [])

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
    isReady: client !== null,
    client: client ?? undefined,
    collections: client?.collections,
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
