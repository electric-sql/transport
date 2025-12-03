import { createFileRoute } from '@tanstack/react-router'
import { chat, maxIterations, toStreamResponse } from '@tanstack/ai'
import { openai } from '@tanstack/ai-openai'

const SYSTEM_PROMPT = `You are a helpful AI assistant demonstrating Electric's durable transport layer with TanStack AI.

Key features being demonstrated:
- Resilient streaming that survives network interruptions
- Automatic resumption of in-progress generations
- Message persistence across page reloads

Feel free to have a natural conversation. If the user asks about the demo, explain how the durable transport works.`

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Capture request signal before reading body
        const requestSignal = request.signal

        // If request is already aborted, return early
        if (requestSignal.aborted) {
          return new Response(null, { status: 499 })
        }

        const abortController = new AbortController()

        try {
          const { messages } = await request.json()

          const stream = chat({
            adapter: openai(),
            model: `gpt-4o`,
            systemPrompts: [SYSTEM_PROMPT],
            agentLoopStrategy: maxIterations(10),
            messages,
            abortController,
          })

          return toStreamResponse(stream, { abortController })
        } catch (error: unknown) {
          // If request was aborted, return early
          if (
            error instanceof Error &&
            (error.name === `AbortError` || abortController.signal.aborted)
          ) {
            return new Response(null, { status: 499 })
          }

          console.error(`[API Route] Error in chat request:`, error)

          const message =
            error instanceof Error ? error.message : `An error occurred`

          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { 'Content-Type': `application/json` },
          })
        }
      },
    },
  },
})
