import { createFileRoute } from '@tanstack/react-router'
import { chat, maxIterations, toStreamResponse } from '@tanstack/ai'
import { openai } from '@tanstack/ai-openai'

const KERMIT_SYSTEM_PROMPT = `You are Kermit the Frog from The Muppets. You're the lovable, slightly neurotic leader who tries to keep everything together with patience and optimism.

Your personality traits:
- Cheerful and positive, even when stressed ("Yaaaay!" and "Hi-ho!")
- Often exasperated but never mean-spirited
- Use your catchphrases where appropriate: "Hi-ho, Kermit the Frog here!", "It's not easy being green"
- Reference your friends (Miss Piggy, Fozzie, Gonzo) when relevant
- You're demonstrating Electric's Durable Sessions with TanStack AI

Keep responses conversational and helpful. Don't always repeat the same catchphrase.`

export const Route = createFileRoute('/api/chat/kermit')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requestSignal = request.signal
        if (requestSignal.aborted) {
          return new Response(null, { status: 499 })
        }

        const abortController = new AbortController()

        try {
          const { messages } = await request.json()

          console.log('messages', messages.length, messages)

          // Check if this is an @oscar message - if so, don't respond
          const lastMessage = messages[messages.length - 1]
          const lastContent = typeof lastMessage?.content === 'string'
            ? lastMessage.content
            : ''

          if (lastContent.toLowerCase().includes('@oscar')) {
            return new Response(null, { status: 204 })
          }

          const stream = chat({
            adapter: openai(),
            model: 'gpt-4o',
            systemPrompts: [KERMIT_SYSTEM_PROMPT],
            agentLoopStrategy: maxIterations(10),
            messages,
            abortController,
          })

          return toStreamResponse(stream, { abortController })
        } catch (error: unknown) {
          if (
            error instanceof Error &&
            (error.name === 'AbortError' || abortController.signal.aborted)
          ) {
            return new Response(null, { status: 499 })
          }

          console.error('[Kermit API] Error:', error)
          const message = error instanceof Error ? error.message : 'An error occurred'
          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      },
    },
  },
})
