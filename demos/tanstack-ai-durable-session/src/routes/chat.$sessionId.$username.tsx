import { useEffect, useRef, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Send, Square, Wifi, WifiOff, RefreshCw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { useDurableChat } from '@electric-sql/react-durable-session'
import type { ConnectionStatus, ChunkRow, DurableChatCollections } from '@electric-sql/react-durable-session'
import { useLiveQuery, eq } from '@tanstack/react-db'
import type { UIMessage } from '@tanstack/ai'
import { proxyUrl } from '../lib/config'
import { KERMIT_AGENT } from '../lib/agents'
import { PresenceBar } from '../components/PresenceBar'
import type { AgentSpec } from '@electric-sql/react-durable-session'

export const Route = createFileRoute('/chat/$sessionId/$username')({
  loader: async ({ params }) => {
    const { sessionId, username } = params

    // Generate a unique deviceId for this tab/page load.
    // This solves the page refresh race condition where logout and login
    // events could conflict (old deviceId logs out, new deviceId logs in).
    const deviceId = crypto.randomUUID()

    // Call the login API (idempotent - creates session if needed, writes presence)
    // This runs on every page load, which is acceptable since the login API is idempotent
    const res = await fetch(`${proxyUrl}/v1/sessions/${sessionId}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actorId: username,
        deviceId,
        name: username,
        defaultAgents: [KERMIT_AGENT],
      }),
    })

    if (!res.ok) {
      throw new Error('Failed to create session')
    }

    return { sessionId, username, deviceId }
  },
  component: ChatPage,
})

function ChatPage() {
  const { sessionId, username, deviceId } = Route.useLoaderData()

  // Store deviceId in sessionStorage so the root layout's logout button can access it
  // Must be in useEffect because loader runs on server where sessionStorage isn't available
  useEffect(() => {
    sessionStorage.setItem('deviceId', deviceId)
    return () => {
      // Don't clear on unmount - we need it for logout which happens after unmount
    }
  }, [deviceId])

  const {
    messages,
    sendMessage,
    isLoading,
    stop,
    connectionStatus,
    collections,
    registerAgents,
    unregisterAgent,
  } = useDurableChat({
    sessionId,
    proxyUrl,
    actorId: username,
  })

  // Auto-logout when page closes
  useEffect(() => {
    const handlePageHide = () => {
      // Use sendBeacon for reliable delivery during page unload
      // Include deviceId so we logout only this tab, not all devices
      // IMPORTANT: Use text/plain to avoid CORS preflight - application/json
      // triggers OPTIONS request which can't complete during page unload
      navigator.sendBeacon(
        `${proxyUrl}/v1/sessions/${sessionId}/logout`,
        new Blob(
          [JSON.stringify({ actorId: username, deviceId })],
          { type: 'text/plain' }
        )
      )
    }

    window.addEventListener('pagehide', handlePageHide)
    return () => window.removeEventListener('pagehide', handlePageHide)
  }, [sessionId, username, deviceId])

  const handleSubmit = async (input: string) => {
    if (!input.trim() || isLoading) return

    await sendMessage(input.trim())
  }

  return (
    <div className="flex h-[calc(100vh-73px)]">
      {/* Cross-tab logout detector - client-only due to useLiveQuery SSR limitation */}
      <ClientOnlyLogoutDetector
        collections={collections}
        username={username}
        deviceId={deviceId}
      />

      {/* Chat Panel */}
      <div className="flex-1 flex flex-col border-r border-gray-800">
        {/* Presence & Agent Bar - client-only due to useLiveQuery SSR limitation */}
        <ClientOnlyPresenceBar
          collections={collections}
          registerAgents={registerAgents}
          unregisterAgent={unregisterAgent}
        />

        {/* Status Bar */}
        <div className="flex items-center px-4 py-2 border-b border-gray-800 bg-gray-900/50">
          <ConnectionStatusBadge status={connectionStatus} />
        </div>

        {/* Messages */}
        <Messages messages={messages} currentUsername={username} />

        {/* Input Area */}
        <ChatInput
          onSubmit={handleSubmit}
          isLoading={isLoading}
          connectionStatus={connectionStatus}
          onStop={stop}
        />
      </div>

      {/* Debug Panel - Client-only to avoid SSR issues with useLiveQuery */}
      <div className="w-80 bg-gray-950 flex flex-col">
        <div className="px-4 py-3 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-white">Stream Debug</h2>
          <p className="text-xs text-gray-500 mt-1">
            Live view of stream chunks via TanStack DB
          </p>
        </div>
        <div className="flex-1 overflow-hidden">
          <ClientOnlyStreamDebug key={sessionId} collections={collections} />
        </div>
      </div>
    </div>
  )
}

/**
 * Client-only wrapper for the presence bar.
 * useLiveQuery doesn't support SSR (missing getServerSnapshot), so we only render on client.
 */
function ClientOnlyPresenceBar({
  collections,
  registerAgents,
  unregisterAgent,
}: {
  collections: DurableChatCollections
  registerAgents: (agents: AgentSpec[]) => Promise<void>
  unregisterAgent: (agentId: string) => Promise<void>
}) {
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
  }, [])

  if (!isClient) {
    return (
      <div className="flex items-center gap-4 px-4 py-2 border-b border-gray-800 bg-gray-900/30 text-gray-500 text-sm">
        Loading...
      </div>
    )
  }

  return (
    <PresenceBar
      collections={collections}
      registerAgents={registerAgents}
      unregisterAgent={unregisterAgent}
    />
  )
}

/**
 * Client-only wrapper for logout detection.
 * useLiveQuery doesn't support SSR (missing getServerSnapshot), so we only render on client.
 */
function ClientOnlyLogoutDetector({
  collections,
  username,
  deviceId,
}: {
  collections: DurableChatCollections
  username: string
  deviceId: string
}) {
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
  }, [])

  if (!isClient) {
    return null
  }

  return (
    <LogoutDetector
      collections={collections}
      username={username}
      deviceId={deviceId}
    />
  )
}

/**
 * Detects when the current user is logged out from another tab/device
 * and redirects to the login page.
 */
function LogoutDetector({
  collections,
  username,
  deviceId,
}: {
  collections: DurableChatCollections
  username: string
  deviceId: string
}) {
  const navigate = useNavigate()
  const [wasLoggedIn, setWasLoggedIn] = useState(false)

  // Watch for current user's presence
  const myPresence = useLiveQuery(
    (q) =>
      q
        .from({ presence: collections.presence })
        .where(({ presence }) => eq(presence.actorId, username)),
    [collections.presence, username]
  )

  // Redirect when logged out from another tab/device
  useEffect(() => {
    // Skip while loading
    if (!myPresence.data) return

    // Check if user exists in presence with current device
    // Query filters for actorId=username, so at most one result
    const userRecord = myPresence.data[0]
    const isLoggedIn = userRecord?.deviceIds.includes(deviceId) ?? false

    if (isLoggedIn) {
      // Mark that we've seen ourselves logged in
      setWasLoggedIn(true)
    } else if (wasLoggedIn) {
      // Was logged in before, but now logged out
      // Clear sessionStorage and redirect
      sessionStorage.removeItem('deviceId')
      navigate({ to: '/login' })
    }
  }, [myPresence.data, deviceId, wasLoggedIn, navigate, username])

  return null
}

/**
 * Client-only wrapper for the stream debug panel.
 * useLiveQuery doesn't support SSR (missing getServerSnapshot), so we only render on client.
 */
function ClientOnlyStreamDebug({ collections }: { collections: DurableChatCollections }) {
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
  }, [])

  if (!isClient) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        Loading stream debug...
      </div>
    )
  }

  return <StreamDebugPanel collections={collections} />
}

/**
 * Stream debug panel that uses useLiveQuery to display live stream data.
 * Only rendered on the client side.
 */
function StreamDebugPanel({ collections }: { collections: DurableChatCollections }) {
  const chunkRows = useLiveQuery(
    (q) => q
      .from({ row: collections.chunks })
      .orderBy(({ row }) => row.createdAt, 'asc')
      .orderBy(({ row }) => row.seq, 'asc'),
    [collections.chunks]
  )

  const parsedChunks = useMemo(() => {
    if (!chunkRows.data) return []
    return chunkRows.data.map((row: ChunkRow) => {
      try {
        return JSON.parse(row.chunk) as { type: string; [key: string]: unknown }
      } catch {
        return { type: 'unknown', raw: row.chunk }
      }
    })
  }, [chunkRows.data])

  return <DebugPanel chunks={parsedChunks} />
}

function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  const config = {
    connected: {
      bg: 'bg-green-500/10',
      text: 'text-green-400',
      border: 'border-green-500/20',
      icon: Wifi,
      label: 'Connected',
    },
    connecting: {
      bg: 'bg-yellow-500/10',
      text: 'text-yellow-400',
      border: 'border-yellow-500/20',
      icon: RefreshCw,
      label: 'Connecting',
    },
    disconnected: {
      bg: 'bg-red-500/10',
      text: 'text-red-400',
      border: 'border-red-500/20',
      icon: WifiOff,
      label: 'Disconnected',
    },
    error: {
      bg: 'bg-red-500/10',
      text: 'text-red-400',
      border: 'border-red-500/20',
      icon: WifiOff,
      label: 'Error',
    },
  }[status]

  const Icon = config.icon

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${config.bg} ${config.text} border ${config.border}`}
    >
      <Icon className={`w-3 h-3 ${status === 'connecting' ? 'animate-spin' : ''}`} />
      <span>{config.label}</span>
    </div>
  )
}

interface MessagesProps {
  messages: UIMessage[]
  currentUsername: string
}

function Messages({ messages, currentUsername }: MessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center text-gray-400">
          <p className="text-lg mb-2">Start a conversation</p>
          <p className="text-sm">
            Messages persist via Durable Streams and sync via TanStack DB
          </p>
          <p className="text-xs mt-2 text-gray-500">
            Type @oscar to talk to Oscar the Grouch
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map((message) => (
        <div
          key={message.id}
          className={`flex gap-3 ${
            message.role === 'assistant' ? 'bg-gray-800/30 -mx-4 px-4 py-4' : ''
          }`}
        >
          <MessageAvatar message={message} currentUsername={currentUsername} />
          <div className="flex-1 min-w-0">
            {message.parts.map((part, index) => {
              if (part.type === 'text' && part.content) {
                return (
                  <div
                    key={`text-${index}`}
                    className="text-white prose dark:prose-invert max-w-none"
                  >
                    <ReactMarkdown
                      rehypePlugins={[
                        rehypeRaw,
                        rehypeSanitize,
                        rehypeHighlight,
                      ]}
                      remarkPlugins={[remarkGfm]}
                    >
                      {part.content}
                    </ReactMarkdown>
                  </div>
                )
              }

              if (part.type === 'tool-call') {
                return (
                  <div
                    key={part.id}
                    className="mt-2 p-3 bg-gray-800 rounded-lg border border-gray-700"
                  >
                    <div className="text-xs text-gray-400 mb-1">
                      Tool: {part.name}
                    </div>
                    <pre className="text-xs text-gray-300 overflow-x-auto">
                      {part.arguments}
                    </pre>
                  </div>
                )
              }

              if (part.type === 'tool-result') {
                return (
                  <div
                    key={`result-${part.toolCallId}`}
                    className="mt-2 p-3 bg-green-900/20 rounded-lg border border-green-700/30"
                  >
                    <div className="text-xs text-green-400 mb-1">
                      Tool Result
                    </div>
                    <pre className="text-xs text-gray-300 overflow-x-auto">
                      {part.content}
                    </pre>
                  </div>
                )
              }

              return null
            })}
          </div>
        </div>
      ))}
      <div ref={messagesEndRef} />
    </div>
  )
}

interface MessageAvatarProps {
  message: UIMessage
  currentUsername: string
}

function MessageAvatar({ message, currentUsername }: MessageAvatarProps) {
  const isAssistant = message.role === 'assistant'

  // Try to get actorId from message metadata if available
  const actorId = (message as unknown as { actorId?: string }).actorId

  if (isAssistant) {
    // Agent avatar - use agent image or fallback
    const agentId = actorId ?? 'kermit'
    return (
      <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-linear-to-r from-orange-500 to-red-600">
        <img
          src={`/img/${agentId}.jpg`}
          alt={agentId}
          className="w-full h-full object-cover"
          onError={(e) => {
            // Hide image on error, show gradient background
            (e.target as HTMLImageElement).style.display = 'none'
          }}
        />
      </div>
    )
  }

  // User avatar from GitHub
  const username = actorId ?? currentUsername
  return (
    <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-gray-700">
      <img
        src={`https://github.com/${username}.png`}
        alt={username}
        className="w-full h-full object-cover"
        onError={(e) => {
          // Hide image on error
          (e.target as HTMLImageElement).style.display = 'none'
        }}
      />
    </div>
  )
}

interface ChatInputProps {
  onSubmit: (input: string) => void
  isLoading: boolean
  connectionStatus: ConnectionStatus
  onStop: () => void
}

function ChatInput({ onSubmit, isLoading, connectionStatus, onStop }: ChatInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = () => {
    if (inputRef.current) {
      onSubmit(inputRef.current.value)
      inputRef.current.value = ''
      inputRef.current.style.height = 'auto'
    }
  }

  return (
    <div className="border-t border-gray-800 p-4">
      {isLoading && (
        <div className="flex justify-center mb-3">
          <button
            onClick={onStop}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Square className="w-4 h-4 fill-current" />
            Stop
          </button>
        </div>
      )}
      {connectionStatus === 'connecting' && (
        <div className="flex justify-center mb-3">
          <div className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Connecting...
          </div>
        </div>
      )}
      <div className="relative">
        <textarea
          ref={inputRef}
          placeholder="Type a message..."
          className="w-full rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-3 pr-12 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-transparent resize-none"
          rows={1}
          disabled={isLoading || connectionStatus !== 'connected'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSubmit()
            }
          }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement
            target.style.height = 'auto'
            target.style.height = `${Math.min(target.scrollHeight, 200)}px`
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={isLoading || connectionStatus !== 'connected'}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-orange-500 hover:text-orange-400 disabled:text-gray-600 transition-colors"
        >
          <Send className="w-5 h-5" />
        </button>
      </div>
    </div>
  )
}

interface ParsedChunk {
  type: string
  [key: string]: unknown
}

function DebugPanel({ chunks }: { chunks: ParsedChunk[] }) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.scrollTop = panelRef.current.scrollHeight
    }
  }, [chunks])

  if (chunks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        Stream chunks will appear here as they sync
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-gray-800">
        <span className="text-sm text-gray-400">
          {chunks.length} chunk{chunks.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div ref={panelRef} className="flex-1 overflow-y-auto p-2 space-y-1">
        {chunks.map((chunk, idx) => (
          <div
            key={idx}
            className="text-xs font-mono bg-gray-800/50 p-2 rounded"
          >
            <span
              className={`inline-block w-16 ${
                chunk.type === 'content'
                  ? 'text-blue-400'
                  : chunk.type === 'done'
                    ? 'text-green-400'
                    : chunk.type === 'tool_call'
                      ? 'text-yellow-400'
                      : chunk.type === 'message_start'
                        ? 'text-purple-400'
                        : 'text-gray-400'
              }`}
            >
              {chunk.type === 'content' && 'delta' in chunk
                ? 'delta'
                : chunk.type}
            </span>
            <span className="text-gray-500 ml-2">
              {chunk.type === 'content' && 'delta' in chunk
                ? (String(chunk.delta)?.slice(0, 50) ?? '')
                : chunk.type === 'done' && 'finishReason' in chunk
                  ? String(chunk.finishReason)
                  : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
