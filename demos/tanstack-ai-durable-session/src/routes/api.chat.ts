import { createFileRoute } from '@tanstack/react-router'
import { chat, maxIterations, toStreamResponse } from '@tanstack/ai'
import { openai } from '@tanstack/ai-openai'

const SYSTEM_PROMPT = `You are a helpful AI assistant demonstrating Electric's Durable Sessions with TanStack AI and TanStack DB.

Key features being demonstrated:
- Messages stored in Durable Streams and synced via TanStack DB collections
- Real-time reactive UI updates from collection changes
- Multi-tab, multi-device synchronization
- Automatic persistence without explicit save operations

This is the new collection-based approach using useDurableChat hook, which provides:
- Reactive messages collection that auto-updates
- Stream collection for raw chunk access
- Tool calls, approvals, and session metadata as live query collections

Feel free to have a natural conversation. If the user asks about the demo, explain how the durable sessions architecture works.`

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
