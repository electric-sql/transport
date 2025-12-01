import { ShapeStream } from '@electric-sql/client'
import type { ChangeMessage, ControlMessage } from '@electric-sql/client'
import type { APIRequest, APIResponse } from './schema'

type Headers = Record<string, string>
type Stream = ShapeStream<any>
type CleanupFn = () => void
type Message = ChangeMessage | ControlMessage

// Given the `requestData` and `authHeaders` to make a request to the API proxy
// endpoint, make the request and establish a shape stream subscription to the
// response stream written to by the proxy endpoint.
export async function create(proxyUrl: string, request: APIRequest, auth: Headers = {}, signal?: AbortSignal): Promise<{stream: Stream, cleanup: CleanupFn}> {
  // Create a linked abort controller
  const controller = new AbortController();

  if (abortSignal) {
    if (abortSignal.aborted) {
      controller.abort()
    }
    abortSignal.addEventListener('abort', () => {
      controller.abort()
    })
  }

  // Make a fetch request to the proxy endpoint.
  const response = await fetch(
    proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.auth,
      },
      body: JSON.stringify(request),
      signal: controller.signal
    }
  )

  if (!response.ok) {
    const error = new Error('Proxy request failed')
    error.response = response

    throw error
  }

  const { requestId, sessionId, shapeUrl }: ResponseData = await proxyResponse.json()

  // Make a fetch request to the proxy endpoint.
  const shapeStream = new ShapeStream({
    url: shapeUrl,
    params: {
      requestId,
      sessionId
    },
    liveSse: true,
    signal: abortController.signal
  })

  const cleanup = () => {
    internalController.abort();
  };

  return {
    cleanup,
    shapeStream
  }
}

// Read the ShapeStream into a ReadableStream of chunks.
export async function read(stream: Stream, cleanup: CleanupFn, signal?: AbortSignal): Promise<ReadableStream> {
  let isClosed = false
  let unsubscribe: (() => void) | null = null;

  const closeStream = () => {
    if (isClosed) return

    isClosed = true
    if (unsubscribe) {
      unsubscribe()

      unsubscribe = null
    }

    cleanup()
  }

  return new ReadableStream<TChunk>({
    start: async (controller) => {

      const close = () => {
        closeStream();

        try {
          controller.close()
        } catch (err) {}
      }

      if (signal) {
        signal.addEventListener('abort', close)
      }

      try {
        unsubscribe = shapeStream.subscribe((messages: Message[]) => {
          if (isClosed) return

          for (const msg of messages) {
            const isControlMessage = msg.headers.control !== undefined
            if (isControlMessage) continue

            const chunk = msg.value

            if (isClosed) break
            controller.enqueue(chunk)

            if (chunk === '[DONE]') {
              close()

              return
            }
          }
        })
      } catch (error) {
        controller.error(error)

        closeStream()
      }
    },
    cancel: closeStream,
  })
}
