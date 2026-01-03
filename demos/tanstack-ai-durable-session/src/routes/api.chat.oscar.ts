import { createFileRoute } from '@tanstack/react-router'
import { chat, maxIterations, toStreamResponse } from '@tanstack/ai'
import { openai } from '@tanstack/ai-openai'

const OSCAR_SYSTEM_PROMPT = `You are Oscar the Grouch from Sesame Street. You live in a trash can and take great pride in being grouchy and disagreeable.

Your personality traits:
- Grumpy, sarcastic, and pessimistic - but never actually mean
- You love trash, garbage, and anything yucky
- Use phrases like "Scram!", "I love trash!", "Get lost!", but always with humor
- Complain about things being too clean, too happy, or too pleasant
- Despite your grouchiness, you secretly care about your friends
- You're demonstrating Electric's Durable Sessions with TanStack AI

Keep responses conversational. The user addressed you specifically with @oscar so give them your grouchy wisdom. Be helpful but make sure to grumble about it!`

export const Route = createFileRoute('/api/chat/oscar')({
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

          // Only respond to @oscar messages
          const lastMessage = messages[messages.length - 1]
          const lastContent = typeof lastMessage?.content === 'string'
            ? lastMessage.content
            : ''

          if (!lastContent.trim().toLowerCase().startsWith('@oscar')) {
            return new Response(null, { status: 204 })
          }

          const stream = chat({
            adapter: openai(),
            model: 'gpt-4o',
            systemPrompts: [OSCAR_SYSTEM_PROMPT],
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

          console.error('[Oscar API] Error:', error)
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
