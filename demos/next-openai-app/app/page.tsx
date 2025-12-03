'use client'

import { useEffect } from 'react'
import { useChat } from '@ai-sdk/react'
import { durableTransport } from '@electric-sql/ai-transport'
import ChatInput from '@/components/chat-input'

const proxyUrl = process.env.NEXT_PUBLIC_PROXY_URL || `http://localhost:4000/api`

// Create the durable session configuration outside the component
// to ensure stable references across renders.
const { durableSession, initialMessages } = durableTransport(
  `demo`,
  { proxyUrl },
  { api: `/api/chat` }
)

export default function Chat() {
  const { error, status, sendMessage, messages, setMessages, regenerate, stop } = useChat({
    ...durableSession
  })

  // Load persisted messages after hydration to avoid SSR mismatch.
  useEffect(() => setMessages(initialMessages), [setMessages])

  return (
    <div className="flex flex-col w-full max-w-md py-24 mx-auto stretch">
      {messages.map((m) => (
        <div key={m.id} className="whitespace-pre-wrap">
          {m.role === `user` ? `User: ` : `AI: `}
          {m.parts.map((part) => {
            if (part.type === `text`) {
              return part.text
            }
          })}
        </div>
      ))}

      {(status === `submitted` || status === `streaming`) && (
        <div className="mt-4 text-gray-500">
          {status === `submitted` && <div>Loading...</div>}
          <button
            type="button"
            className="px-4 py-2 mt-4 text-blue-500 border border-blue-500 rounded-md"
            onClick={stop}
          >
            Stop
          </button>
        </div>
      )}

      {error && (
        <div className="mt-4">
          <div className="text-red-500">An error occurred: {error.message}</div>
          <button
            type="button"
            className="px-4 py-2 mt-4 text-blue-500 border border-blue-500 rounded-md"
            onClick={() => regenerate()}
          >
            Retry
          </button>
        </div>
      )}

      <ChatInput status={status} onSubmit={(text) => sendMessage({ text })} />
    </div>
  )
}
