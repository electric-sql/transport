import { useEffect, useRef, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Send, Square, Trash2, Wifi, WifiOff, RefreshCw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { useDurableChat, type DurableChatClient } from '@electric-sql/react-ai-db'
import type { AgentSpec, ConnectionStatus, StreamRowWithOffset } from '@electric-sql/react-ai-db'
import { useLiveQuery } from '@tanstack/react-db'
import type { UIMessage } from '@tanstack/ai'

// AI DB Proxy URL (handles session management and agent invocation)
const proxyUrl =
  typeof window !== `undefined`
    ? (window as unknown as { ENV?: { PROXY_URL?: string } }).ENV?.PROXY_URL ??
      `http://localhost:4000`
    : `http://localhost:4000`

// Demo app URL (where our /api/chat endpoint lives)
const appUrl =
  typeof window !== `undefined`
    ? window.location.origin
    : `http://localhost:5175`

// Stable session ID - could be made dynamic for multi-session support
const SESSION_ID = `tanstack-durable-demo`

// Default agent spec - tells ai-db-proxy where to forward LLM requests
const defaultAgent: AgentSpec = {
  id: 'openai-chat',
  name: 'OpenAI Chat',
  endpoint: `${appUrl}/api/chat`,
  method: 'POST',
  triggers: 'user-messages',
}

function ChatPage() {
  const {
    messages,
    sendMessage,
    isLoading,
    stop,
    clear,
    connectionStatus,
    collections,
  } = useDurableChat({
    sessionId: SESSION_ID,
    proxyUrl,
    agent: defaultAgent,
  })

  const handleSubmit = async (input: string) => {
    if (!input.trim() || isLoading) return
    await sendMessage(input.trim())
  }

  return (
    <div className="flex h-[calc(100vh-73px)]">
      {/* Chat Panel */}
      <div className="flex-1 flex flex-col border-r border-gray-800">
        {/* Status Bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-900/50">
          <ConnectionStatusBadge status={connectionStatus} />
          <button
            onClick={clear}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            Clear Chat
          </button>
        </div>

        {/* Messages */}
        <Messages messages={messages} />

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
          <ClientOnlyStreamDebug collections={collections} />
        </div>
      </div>
    </div>
  )
}

/**
 * Client-only wrapper for the stream debug panel.
 * useLiveQuery doesn't support SSR (missing getServerSnapshot), so we only render on client.
 */
function ClientOnlyStreamDebug({ collections }: { collections: DurableChatClient['collections'] }) {
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
function StreamDebugPanel({ collections }: { collections: DurableChatClient['collections'] }) {
  // Use useLiveQuery to reactively get stream rows for debug panel
  const streamRows = useLiveQuery(
    (q) => q.from({ row: collections.stream }),
    [collections.stream]
  )

  // Also query the messages collection to see materialization
  const messagesQuery = useLiveQuery(
    (q) => q.from({ msg: collections.messages }),
    [collections.messages]
  )

  // DEBUG: Log raw stream data
  useEffect(() => {
    console.group('🔍 DEBUG: Stream Collection')
    console.log('streamRows.data:', streamRows.data)
    console.log('streamRows.data length:', streamRows.data?.length ?? 0)
    if (streamRows.data && streamRows.data.length > 0) {
      console.log('First row:', streamRows.data[0])
      console.log('First row keys:', Object.keys(streamRows.data[0]))
      console.log('First row chunk (raw):', streamRows.data[0].chunk)
      console.log('First row chunk type:', typeof streamRows.data[0].chunk)
    }
    console.groupEnd()
  }, [streamRows.data])

  // DEBUG: Log messages collection
  useEffect(() => {
    console.group('🔍 DEBUG: Messages Collection')
    console.log('messagesQuery.data:', messagesQuery.data)
    console.log('messagesQuery.data length:', messagesQuery.data?.length ?? 0)
    if (messagesQuery.data && messagesQuery.data.length > 0) {
      messagesQuery.data.forEach((msg, i) => {
        console.log(`Message ${i}:`, msg)
      })
    }
    console.groupEnd()
  }, [messagesQuery.data])

  // Parse chunks from stream rows for debug display
  const parsedChunks = useMemo(() => {
    if (!streamRows.data) return []
    return streamRows.data.map((row: StreamRowWithOffset) => {
      // DEBUG: Log each chunk parsing attempt
      console.log('🔍 Parsing chunk:', {
        chunk: row.chunk,
        chunkType: typeof row.chunk,
        messageId: row.messageId,
        seq: row.seq
      })
      try {
        const parsed = JSON.parse(row.chunk) as { type: string; [key: string]: unknown }
        console.log('🔍 Parsed result:', parsed)
        return parsed
      } catch (e) {
        console.error('🔍 Parse error:', e, 'raw:', row.chunk)
        return { type: 'unknown', raw: row.chunk }
      }
    })
  }, [streamRows.data])

  return <DebugPanel chunks={parsedChunks} />
}

function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  const config = {
    connected: {
      bg: `bg-green-500/10`,
      text: `text-green-400`,
      border: `border-green-500/20`,
      icon: Wifi,
      label: `Connected`,
    },
    connecting: {
      bg: `bg-yellow-500/10`,
      text: `text-yellow-400`,
      border: `border-yellow-500/20`,
      icon: RefreshCw,
      label: `Connecting`,
    },
    disconnected: {
      bg: `bg-red-500/10`,
      text: `text-red-400`,
      border: `border-red-500/20`,
      icon: WifiOff,
      label: `Disconnected`,
    },
    error: {
      bg: `bg-red-500/10`,
      text: `text-red-400`,
      border: `border-red-500/20`,
      icon: WifiOff,
      label: `Error`,
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

function Messages({ messages }: { messages: UIMessage[] }) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: `smooth` })
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center text-gray-400">
          <p className="text-lg mb-2">Start a conversation</p>
          <p className="text-sm">
            Messages persist via Durable Streams and sync via TanStack DB
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
          className={`flex gap-4 ${
            message.role === `assistant` ? `bg-gray-800/30 -mx-4 px-4 py-4` : ``
          }`}
        >
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-medium shrink-0 ${
              message.role === `assistant`
                ? `bg-linear-to-r from-orange-500 to-red-600 text-white`
                : `bg-gray-700 text-white`
            }`}
          >
            {message.role === `assistant` ? `AI` : `U`}
          </div>
          <div className="flex-1 min-w-0">
            {message.parts.map((part, index) => {
              if (part.type === `text` && part.content) {
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

              if (part.type === `tool-call`) {
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

              if (part.type === `tool-result`) {
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
          placeholder="Type a message... (Shift+Enter for new line)"
          className="w-full rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-3 pr-12 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-transparent resize-none"
          rows={1}
          disabled={isLoading || connectionStatus !== 'connected'}
          onKeyDown={(e) => {
            if (e.key === `Enter` && !e.shiftKey) {
              e.preventDefault()
              handleSubmit()
            }
          }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement
            target.style.height = `auto`
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

  // Auto-scroll to bottom when new chunks arrive
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
          {chunks.length} chunk{chunks.length !== 1 ? `s` : ``}
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
                chunk.type === `content`
                  ? `text-blue-400`
                  : chunk.type === `done`
                    ? `text-green-400`
                    : chunk.type === `tool_call`
                      ? `text-yellow-400`
                      : chunk.type === `message_start`
                        ? `text-purple-400`
                        : `text-gray-400`
              }`}
            >
              {chunk.type}
            </span>
            <span className="text-gray-500 ml-2">
              {chunk.type === `content` && `delta` in chunk
                ? (String(chunk.delta)?.slice(0, 50) ?? ``)
                : chunk.type === `done` && `finishReason` in chunk
                  ? String(chunk.finishReason)
                  : ``}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export const Route = createFileRoute(`/`)({
  component: ChatPage,
})
