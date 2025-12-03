import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Send, Square, Trash2, Wifi, WifiOff } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { useChat } from '@tanstack/ai-react'
import { durableTransport } from '@electric-sql/tanstack-ai-transport'
import type { UIMessage } from '@tanstack/ai-client'
import type { StreamChunk } from '@tanstack/ai'

// ============================================================================
// Configuration
// ============================================================================

const proxyUrl =
  typeof window !== `undefined`
    ? (window as unknown as { ENV?: { PROXY_URL?: string } }).ENV?.PROXY_URL ??
      `http://localhost:4000/api`
    : `http://localhost:4000/api`

// Create the durable transport outside the component
// This ensures stable references across renders
const { durableSession, initialMessages, clearSession } =
  durableTransport(`tanstack-demo`, {
    proxyUrl,
    api: `/api/chat`,
  })

// ============================================================================
// Components
// ============================================================================

function ConnectionStatus({ isConnected }: { isConnected: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
        isConnected
          ? `bg-green-500/10 text-green-400 border border-green-500/20`
          : `bg-red-500/10 text-red-400 border border-red-500/20`
      }`}
    >
      {isConnected ? (
        <>
          <Wifi className="w-3 h-3" />
          <span>Connected</span>
        </>
      ) : (
        <>
          <WifiOff className="w-3 h-3" />
          <span>Reconnecting...</span>
        </>
      )}
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
            Messages are persisted and streams are resumable
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

function DebugPanel({
  chunks,
  onClearChunks,
}: {
  chunks: StreamChunk[]
  onClearChunks: () => void
}) {
  if (chunks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        Stream chunks will appear here as they arrive
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-gray-800">
        <span className="text-sm text-gray-400">
          {chunks.length} chunk{chunks.length !== 1 ? `s` : ``}
        </span>
        <button
          onClick={onClearChunks}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Clear
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
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
                      : `text-gray-400`
              }`}
            >
              {chunk.type}
            </span>
            <span className="text-gray-500 ml-2">
              {chunk.type === `content` && `content` in chunk
                ? (chunk.content?.slice(0, 50) ?? ``) +
                  ((chunk.content?.length ?? 0) > 50 ? `...` : ``)
                : chunk.type === `done` && `finishReason` in chunk
                  ? chunk.finishReason
                  : ``}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ChatPage() {
  const [chunks, setChunks] = useState<StreamChunk[]>([])
  const [input, setInput] = useState(``)
  const [isConnected, setIsConnected] = useState(true)

  const { messages, sendMessage, isLoading, stop, setMessages, clear } =
    useChat({
      ...durableSession, // Spreads: id, connection, onFinish
      onChunk: (chunk) => {
        setChunks((prev) => [...prev, chunk])
        // Consider connected when we receive chunks
        setIsConnected(true)
      },
      onError: () => {
        setIsConnected(false)
      },
    })

  // Load persisted messages after hydration
  useEffect(() => {
    if (initialMessages.length > 0) {
      setMessages(initialMessages)
    }
  }, [setMessages])

  const handleSubmit = async () => {
    if (!input.trim() || isLoading) return

    const message = input.trim()
    setInput(``)
    await sendMessage(message)
  }

  const handleClear = () => {
    clear()
    clearSession()
    setChunks([])
  }

  return (
    <div className="flex h-[calc(100vh-73px)]">
      {/* Chat Panel */}
      <div className="flex-1 flex flex-col border-r border-gray-800">
        {/* Status Bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-900/50">
          <ConnectionStatus isConnected={isConnected} />
          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            Clear Chat
          </button>
        </div>

        {/* Messages */}
        <Messages messages={messages} />

        {/* Input Area */}
        <div className="border-t border-gray-800 p-4">
          {isLoading && (
            <div className="flex justify-center mb-3">
              <button
                onClick={stop}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <Square className="w-4 h-4 fill-current" />
                Stop
              </button>
            </div>
          )}
          <div className="relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message... (Shift+Enter for new line)"
              className="w-full rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-3 pr-12 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-transparent resize-none"
              rows={1}
              disabled={isLoading}
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
              disabled={!input.trim() || isLoading}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-orange-500 hover:text-orange-400 disabled:text-gray-600 transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Debug Panel */}
      <div className="w-80 bg-gray-950 flex flex-col">
        <div className="px-4 py-3 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-white">Stream Debug</h2>
          <p className="text-xs text-gray-500 mt-1">
            Raw chunks from the AI stream
          </p>
        </div>
        <div className="flex-1 overflow-hidden">
          <DebugPanel chunks={chunks} onClearChunks={() => setChunks([])} />
        </div>
      </div>
    </div>
  )
}

export const Route = createFileRoute(`/`)({
  component: ChatPage,
})
