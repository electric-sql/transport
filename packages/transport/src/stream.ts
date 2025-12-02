import { ShapeStream } from '@electric-sql/client'
import type { ChangeMessage, ControlMessage } from '@electric-sql/client'
import { responseSchema, type APIRequest, type APIResponse } from './schema'
import {
  setActiveGeneration,
  clearActiveGeneration,
  type ActiveGeneration,
} from './storage'

type CleanupFn = () => void
type Headers = Record<string, string>
type Message = ChangeMessage<Record<string, unknown>> | ControlMessage
type Stream = ShapeStream<Record<string, unknown>>

export type StreamResult = {
  stream: Stream
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
  data: APIRequest,
  auth: Headers,
  signal: AbortSignal
): Promise<APIResponse> {
  const response = await fetch(proxyUrl, {
    method: `POST`,
    body: JSON.stringify(data),
    headers: {
      ...auth,
      'Content-Type': `application/json`,
    },
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
// make the request and then establish a shape stream subscription to the response stream
// written to by the proxy endpoint.
export async function create(
  proxyUrl: string,
  data: APIRequest,
  auth: Headers = {},
  externalAbortSignal?: AbortSignal
): Promise<StreamResult> {
  const controller = createLinkedAbortController(externalAbortSignal)
  const signal = controller.signal

  const responseData = await fetchProxyResponseData(
    proxyUrl,
    data,
    auth,
    signal
  )
  const { requestId, sessionId, streamUrl /*, errorUrl */ } = responseData

  const stream = new ShapeStream({
    url: streamUrl,
    params: {
      requestId,
      sessionId,
    },
    liveSse: true,
    signal: signal,
  })

  // XXX todo: also subscribe to `errorUrl` if provided

  return {
    stream,
    cleanup: () => {
      try {
        controller.abort()
      } finally {
        clearActiveGeneration(sessionId)
      }
    },
    sessionId,
    responseData,
  }
}

// Given the persisted active generation data, resume the stream subscription.
export async function resume(
  { data, handle, offset }: ActiveGeneration,
  externalAbortSignal?: AbortSignal
): Promise<StreamResult> {
  const controller = createLinkedAbortController(externalAbortSignal)
  const signal = controller.signal

  const { requestId, sessionId, streamUrl /*, errorUrl */ } = data

  const stream = new ShapeStream({
    url: streamUrl,
    handle: handle,
    offset: offset,
    params: {
      requestId,
      sessionId,
    },
    liveSse: true,
    signal: signal,
  })

  // XXX todo: also subscribe to `errorUrl` if provided

  return {
    stream,
    cleanup: () => {
      try {
        controller.abort()
      } finally {
        clearActiveGeneration(sessionId)
      }
    },
    sessionId,
    responseData: data,
  }
}

// Read the ShapeStream into a ReadableStream of chunks.
export async function read(
  stream: Stream,
  cleanup: CleanupFn,
  sessionId: string,
  responseData: APIResponse,
  signal?: AbortSignal
): Promise<ReadableStream> {
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

  return new ReadableStream<string>({
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
        unsubscribe = stream.subscribe((messages: Message[]) => {
          if (isClosed) return

          for (const msg of messages) {
            const isControlMessage = `control` in msg.headers
            if (isControlMessage) continue

            const changeMsg = msg as ChangeMessage<Record<string, unknown>>
            const row = changeMsg.value

            // Check the type field from our chunks table
            if (row.type === `done`) {
              close()
              return
            }

            if (row.type === `error`) {
              controller.error(
                new Error((row.data as string) || `Stream error`)
              )
              closeStream()
              return
            }

            // Regular data chunk - enqueue the raw content
            if (isClosed) break
            controller.enqueue(row.data as string)
          }

          // Persist the active generation state after processing each batch
          // At this point, shapeHandle is guaranteed to be set (we've received messages)
          setActiveGeneration(
            sessionId,
            responseData,
            stream.shapeHandle!,
            stream.lastOffset
          )
        })
      } catch (error) {
        controller.error(error)

        closeStream()
      }
    },
    cancel: closeStream,
  })
}
