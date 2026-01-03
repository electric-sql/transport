# AI SDK, Next.js, and OpenAI Chat Example

This example shows how to use the [Vercel AI SDK](https://ai-sdk.dev/docs) with [Next.js](https://nextjs.org/) and [OpenAI](https://openai.com) streaming chat demo with the Durable Streams transport.

The key code is in app/page.tsx:

```ts
import { useEffect } from 'react'
import { useChat } from '@ai-sdk/react'
import { durableTransport } from '@durable-streams/ai-transport'

const { durableSession, initialMessages } = durableTransport(
  `demo`,
  { proxyUrl },
  { api: `/api/chat` }
)

export default function Chat() {
  const { error, status, sendMessage, messages, setMessages, regenerate, stop } = useChat({
    ...durableSession
  })

  useEffect(() => setMessages(initialMessages), [setMessages])

  // ...
}
```

This configures the default useChat hook to use a durable transport adapter with local message persistence. It supports persistent chat history, resumability of active generations and tolerates tab backgrounding and patchy network connectivity.

It doesn't demonstrate server-side message persistence (only the raw active generation streams are persistent) and it doesn't work with multi-tab or multi-user.
