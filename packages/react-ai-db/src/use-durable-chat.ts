/**
 * useDurableChat - React hook for durable chat.
 *
 * Provides TanStack AI-compatible API backed by Durable Streams
 * with automatic React integration.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { DurableChatClient } from '@electric-sql/ai-db'
import type { UIMessage, AnyClientTool } from '@tanstack/ai'
import type { UseDurableChatOptions, UseDurableChatReturn } from './types'

/**
 * React hook for durable chat with TanStack AI-compatible API.
 *
 * This hook provides:
 * - Automatic client lifecycle management
 * - Reactive messages state
 * - TanStack AI useChat-compatible interface
 * - Access to underlying collections for custom queries
 *
 * @example Basic usage
 * ```typescript
 * import { useDurableChat } from '@electric-sql/react-ai-db'
 *
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
 *
 * @example With custom queries
 * ```typescript
 * import { useDurableChat } from '@electric-sql/react-ai-db'
 * import { useLiveQuery } from '@tanstack/react-db'
 *
 * function AdvancedChat() {
 *   const chat = useDurableChat({
 *     sessionId: 'my-session',
 *     proxyUrl: 'http://localhost:4000',
 *   })
 *
 *   // Custom query: pending approvals
 *   const pendingApprovals = useLiveQuery((q) =>
 *     q.from({ a: chat.collections.approvals })
 *       .where(({ a }) => eq(a.status, 'pending'))
 *   )
 *
 *   return (
 *     <div>
 *       <ConnectionBadge status={chat.connectionStatus} />
 *       <Messages messages={chat.messages} />
 *       <ApprovalDialogs approvals={pendingApprovals.data} />
 *       <Input onSubmit={chat.sendMessage} disabled={chat.isLoading} />
 *     </div>
 *   )
 * }
 * ```
 *
 * @example Multi-agent chat
 * ```typescript
 * import { useDurableChat } from '@electric-sql/react-ai-db'
 *
 * function MultiAgentChat() {
 *   const chat = useDurableChat({
 *     sessionId: 'team-session',
 *     proxyUrl: 'http://localhost:4000',
 *     actorId: currentUser.id,
 *   })
 *
 *   useEffect(() => {
 *     chat.registerAgents([
 *       {
 *         id: 'assistant',
 *         name: 'Claude',
 *         endpoint: 'https://api.anthropic.com/v1/messages',
 *         triggers: 'user-messages',
 *       },
 *     ])
 *     return () => {
 *       chat.unregisterAgent('assistant')
 *     }
 *   }, [])
 *
 *   return (
 *     <div>
 *       {chat.messages.map(m => (
 *         <Message
 *           key={m.id}
 *           message={m}
 *           isCurrentUser={m.actorId === currentUser.id}
 *         />
 *       ))}
 *     </div>
 *   )
 * }
 * ```
 */
export function useDurableChat<
  TTools extends ReadonlyArray<AnyClientTool> = AnyClientTool[],
>(options: UseDurableChatOptions<TTools>): UseDurableChatReturn<TTools> {
  const { autoConnect = true, ...clientOptions } = options

  // Track messages in React state for reactivity
  const [messages, setMessages] = useState<UIMessage[]>(
    options.initialMessages ?? []
  )
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | undefined>()
  const [connectionStatus, setConnectionStatus] = useState<
    'disconnected' | 'connecting' | 'connected' | 'error'
  >('disconnected')

  // Ref to track if we've initialized
  const initializedRef = useRef(false)

  // Create client with stable reference
  // Use useMemo to ensure client is only created once per sessionId
  const client = useMemo(() => {
    return new DurableChatClient<TTools>({
      ...clientOptions,
      // Override callbacks to update React state
      onMessagesChange: (msgs) => {
        setMessages(msgs as UIMessage[])
        clientOptions.onMessagesChange?.(msgs)
      },
      onError: (err) => {
        setError(err)
        clientOptions.onError?.(err)
      },
    })
    // Only recreate if sessionId or proxyUrl changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientOptions.sessionId, clientOptions.proxyUrl])

  // Handle auto-connect and cleanup
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    if (autoConnect) {
      setConnectionStatus('connecting')

      client
        .connect()
        .then(() => {
          setConnectionStatus('connected')
          // Sync initial messages from client
          setMessages(client.messages as UIMessage[])
        })
        .catch((err) => {
          setConnectionStatus('error')
          setError(err)
        })
    }

    // Subscribe to active generations for isLoading state
    const activeGensUnsubscribe = client.collections.activeGenerations.subscribeChanges(() => {
      setIsLoading(client.isLoading)
    })

    // Subscribe to messages collection for message updates
    const messagesUnsubscribe = client.collections.messages.subscribeChanges(() => {
      setMessages(client.messages as UIMessage[])
    })

    // Subscribe to session meta for connection status
    const metaUnsubscribe = client.collections.sessionMeta.subscribeChanges(() => {
      setConnectionStatus(client.connectionStatus)
    })

    return () => {
      activeGensUnsubscribe.unsubscribe()
      messagesUnsubscribe.unsubscribe()
      metaUnsubscribe.unsubscribe()
      client.dispose()
    }
  }, [client, autoConnect])

  // Memoized callbacks for stable references
  const sendMessage = useCallback(
    async (content: string) => {
      try {
        await client.sendMessage(content)
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)))
        throw err
      }
    },
    [client]
  )

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

  const setMessagesManually = useCallback(
    (msgs: UIMessage[]) => {
      setMessages(msgs)
      client.setMessagesManually(msgs)
    },
    [client]
  )

  const addToolResult = useCallback(
    async (result: Parameters<typeof client.addToolResult>[0]) => {
      await client.addToolResult(result)
    },
    [client]
  )

  const addToolApprovalResponse = useCallback(
    async (response: Parameters<typeof client.addToolApprovalResponse>[0]) => {
      await client.addToolApprovalResponse(response)
    },
    [client]
  )

  const fork = useCallback(
    async (opts?: Parameters<typeof client.fork>[0]) => {
      return client.fork(opts)
    },
    [client]
  )

  const registerAgents = useCallback(
    async (agents: Parameters<typeof client.registerAgents>[0]) => {
      await client.registerAgents(agents)
    },
    [client]
  )

  const unregisterAgent = useCallback(
    async (agentId: string) => {
      await client.unregisterAgent(agentId)
    },
    [client]
  )

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
    setMessages: setMessagesManually,
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
