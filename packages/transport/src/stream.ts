import { stream as durableStream } from '@durable-streams/client'
import type { StreamResponse, Offset } from '@durable-streams/client'
import {
  responseSchema,
  streamEventSchema,
  type APIResponse,
  type StreamEvent,
} from './schema'
import {
  setActiveGeneration,
  clearActiveGeneration,
  type ActiveGeneration,
} from './storage'

type CleanupFn = () => void
type AuthHeaders = Record<string, string>

export type CreateRequest = {
  sessionId: string
  requestId: string
  targetUrl: string
  method: string
  headers: Record<string, string>
  body: BodyInit | null
}

export type StreamResult = {
  streamResponse: StreamResponse<StreamEvent>
  cleanup: CleanupFn
  sessionId: string
  responseData: APIResponse
}

export interface ProxyError extends Error {
  response: Response
}

function createLinkedAbortController(signal?: AbortSignal): AbortController {
  const controller = new AbortController()

  if (signal !== undefined) {
    if (signal.aborted) {
      controller.abort()
    } else {
      signal.addEventListener(`abort`, () => {
        controller.abort()
      })
    }
  }

  return controller
}

async function fetchProxyResponseData(
  proxyUrl: string,
  request: CreateRequest,
  auth: AuthHeaders,
  signal: AbortSignal
): Promise<APIResponse> {
  const { sessionId, requestId, targetUrl, method, headers, body } = request

  // Build proxy URL with path params
  const url = `${proxyUrl}/${sessionId}/${requestId}`

  const response = await fetch(url, {
    method: `POST`,
    headers: {
      ...auth,
      ...headers,
      'X-Proxy-Url': targetUrl,
      'X-Proxy-Method': method,
    },
    body,
    signal,
  })

  if (!response.ok) {
    const error = new Error(`Proxy request failed`) as ProxyError
    error.response = response

    throw error
  }

  const responseData = await response.json()

  return responseSchema.parse(responseData)
}

// Given the request `data` and `auth` headers to make a request to the API proxy endpoint,
// make the request and then establish a Durable Stream subscription to read the response.
export async function create(
  proxyUrl: string,
  request: CreateRequest,
  auth: AuthHeaders = {},
  externalAbortSignal?: AbortSignal
): Promise<StreamResult> {
  const controller = createLinkedAbortController(externalAbortSignal)
  const signal = controller.signal

  const responseData = await fetchProxyResponseData(
    proxyUrl,
    request,
    auth,
    signal
  )
  const { sessionId, streamUrl } = responseData

  // Subscribe to the Durable Stream with SSE for live updates
  const streamResponse = await durableStream<StreamEvent>({
    url: streamUrl,
    offset: `-1`, // Start from beginning
    live: `sse`,
    signal,
  })

  return {
    streamResponse,
    cleanup: () => {
      try {
        controller.abort()
        streamResponse.cancel()
      } finally {
        clearActiveGeneration(sessionId)
      }
    },
    sessionId,
    responseData,
  }
}

export type ResumeOptions = {
  /**
   * When true, replay the stream from the beginning instead of resuming
   * from the last known offset. This is required for page-reload resume
   * where the AI SDK needs to reconstruct complete messages from the start.
   *
   * When false (default), resume from the stored offset for efficient
   * continuation during network reconnection scenarios.
   */
  replayFromStart?: boolean
}

// Given the persisted active generation data, resume the stream subscription.
//
// By default, resumes from the stored offset (efficient for network reconnection).
// Set `replayFromStart: true` to replay from the beginning (required for page-reload
// resume where the AI SDK needs complete message reconstruction).
export async function resume(
  activeGen: ActiveGeneration,
  options: ResumeOptions = {},
  externalAbortSignal?: AbortSignal
): Promise<StreamResult> {
  const { replayFromStart = false } = options
  const controller = createLinkedAbortController(externalAbortSignal)
  const signal = controller.signal

  const { sessionId, streamUrl } = activeGen.data

  // When replaying from start, use offset -1 to get all data from the beginning
  const offset: Offset = replayFromStart ? `-1` : activeGen.streamOffset

  // Subscribe to the Durable Stream with SSE for live updates
  const streamResponse = await durableStream<StreamEvent>({
    url: streamUrl,
    offset,
    live: `sse`,
    signal,
  })

  return {
    streamResponse,
    cleanup: () => {
      try {
        controller.abort()
        streamResponse.cancel()
      } finally {
        clearActiveGeneration(sessionId)
      }
    },
    sessionId,
    responseData: activeGen.data,
  }
}

/**
 * Read a Durable Stream into a ReadableStream of chunks.
 *
 * This function subscribes to the stream and parses JSON events:
 * - data events: contain raw SSE chunks from the upstream API
 * - done events: signal stream completion
 * - error events: signal stream errors
 *
 * The function persists the stream offset for resumption after each batch.
 */
export async function read(
  streamResponse: StreamResponse<StreamEvent>,
  cleanup: CleanupFn,
  sessionId: string,
  responseData: APIResponse,
  signal?: AbortSignal
): Promise<ReadableStream> {
  const encoder = new TextEncoder()
  let isClosed = false
  let unsubscribe: (() => void) | null = null

  const closeStream = () => {
    if (isClosed) return

    isClosed = true
    if (unsubscribe !== null) {
      unsubscribe()
      unsubscribe = null
    }

    cleanup()
  }

  return new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const close = () => {
        closeStream()

        try {
          controller.close()
        } catch (_err) {
          // Controller may already be closed
        }
      }

      if (signal) {
        signal.addEventListener(`abort`, close)
      }

      try {
        // Subscribe to the Durable Stream
        unsubscribe = streamResponse.subscribeJson(async (batch) => {
          if (isClosed) return

          for (const item of batch.items) {
            if (isClosed) break

            // Parse and validate the event
            const parseResult = streamEventSchema.safeParse(item)
            if (!parseResult.success) {
              // Skip malformed events
              continue
            }

            const event = parseResult.data

            if (event.type === `data`) {
              // Emit raw data payload
              if (!isClosed) {
                controller.enqueue(encoder.encode(event.payload))
              }
            } else if (event.type === `done`) {
              // Stream completed
              closeStream()
              try {
                controller.close()
              } catch (_err) {
                // Controller may already be closed
              }
              return
            } else if (event.type === `error`) {
              // Stream error
              closeStream()
              try {
                controller.error(new Error(event.message))
              } catch (_err) {
                // Controller may already be closed/errored
              }
              return
            }
          }

          // Persist state for resumption after each batch
          if (!isClosed) {
            setActiveGeneration(sessionId, responseData, batch.offset)
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
