import { ShapeStream } from '@electric-sql/client'
import type { ChangeMessage, ControlMessage } from '@electric-sql/client'
import { responseSchema, type APIResponse } from './schema'
import {
  setActiveGeneration,
  clearActiveGeneration,
  type ActiveGeneration,
} from './storage'

type CleanupFn = () => void
type AuthHeaders = Record<string, string>
type Message = ChangeMessage<Record<string, unknown>> | ControlMessage
type Stream = ShapeStream<Record<string, unknown>>

export type CreateRequest = {
  sessionId: string
  requestId: string
  targetUrl: string
  method: string
  headers: Record<string, string>
  body: BodyInit | null
}

export type StreamResult = {
  dataStream: Stream
  controlStream: Stream
  cleanup: CleanupFn
  sessionId: string
  responseData: APIResponse
}

export interface ProxyError extends Error {
  response: Response
}

// Pending close state - either done or error
type PendingClose = { type: `done` } | { type: `error`; message: string }

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
// make the request and then establish shape stream subscriptions to both the data and control
// streams written to by the proxy endpoint.
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
  const { requestId, sessionId, streamUrl, controlUrl } = responseData

  const dataStream = new ShapeStream({
    url: streamUrl,
    params: {
      requestId,
      sessionId,
    },
    liveSse: true,
    signal: signal,
  })

  const controlStream = new ShapeStream({
    url: controlUrl,
    params: {
      requestId,
      sessionId,
    },
    liveSse: true,
    signal: signal,
  })

  return {
    dataStream,
    controlStream,
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

// Given the persisted active generation data, resume the stream subscriptions.
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

  const { requestId, sessionId, streamUrl, controlUrl } = activeGen.data

  // When replaying from start, don't pass handle/offset so we get all data
  // from the beginning of this request's stream.
  const dataStream = new ShapeStream({
    url: streamUrl,
    ...(replayFromStart
      ? {}
      : {
          handle: activeGen.dataShapeHandle,
          offset: activeGen.dataShapeOffset,
        }),
    params: {
      requestId,
      sessionId,
    },
    liveSse: true,
    signal: signal,
  })

  const controlStream = new ShapeStream({
    url: controlUrl,
    ...(replayFromStart
      ? {}
      : {
          handle: activeGen.controlShapeHandle,
          offset: activeGen.controlShapeOffset,
        }),
    params: {
      requestId,
      sessionId,
    },
    liveSse: true,
    signal: signal,
  })

  return {
    dataStream,
    controlStream,
    cleanup: () => {
      try {
        controller.abort()
      } finally {
        clearActiveGeneration(sessionId)
      }
    },
    sessionId,
    responseData: activeGen.data,
  }
}

/**
 * Read both the data and control ShapeStreams into a single ReadableStream of chunks.
 *
 * This function subscribes to both streams and coordinates their messages:
 * - Data stream: contains raw data chunks
 * - Control stream: contains lifecycle events (done, error)
 *
 * The control message includes a `data_row_id` field that specifies the row ID
 * of the last data chunk. The client waits for all data up to that row ID before
 * closing or erroring the stream, preventing race conditions.
 */
export async function read(
  dataStream: Stream,
  controlStream: Stream,
  cleanup: CleanupFn,
  sessionId: string,
  responseData: APIResponse,
  signal?: AbortSignal
): Promise<ReadableStream> {
  const encoder = new TextEncoder()
  let isClosed = false
  let dataUnsubscribe: (() => void) | null = null
  let controlUnsubscribe: (() => void) | null = null

  // Row ID tracking for close synchronization
  let lastReceivedRowId = `0`.padStart(20, `0`)
  let closeAfterRowId: string | null = null
  let pendingClose: PendingClose | null = null

  const closeStream = () => {
    if (isClosed) return

    isClosed = true
    if (dataUnsubscribe !== null) {
      dataUnsubscribe()
      dataUnsubscribe = null
    }
    if (controlUnsubscribe !== null) {
      controlUnsubscribe()
      controlUnsubscribe = null
    }

    cleanup()
  }

  return new ReadableStream<Uint8Array>({
    start: async (controller) => {
      // Check if we should close/error the stream
      // Called after each data row AND after receiving control messages
      const maybeClose = () => {
        if (isClosed) return
        if (pendingClose === null) return
        if (closeAfterRowId === null) return
        if (lastReceivedRowId < closeAfterRowId) return

        // We've received all data up to the close point
        if (pendingClose.type === `done`) {
          closeStream()
          try {
            controller.close()
          } catch (_err) {
            // Controller may already be closed
          }
        } else {
          // Error case - deliver the error after all data
          closeStream()
          try {
            controller.error(new Error(pendingClose.message))
          } catch (_err) {
            // Controller may already be closed/errored
          }
        }
      }

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
        // Subscribe to data stream
        dataUnsubscribe = dataStream.subscribe((messages: Message[]) => {
          if (isClosed) return

          for (const msg of messages) {
            if (isClosed) break

            const isControlMessage = `control` in msg.headers
            if (isControlMessage) continue

            const changeMsg = msg as ChangeMessage<Record<string, unknown>>
            const row = changeMsg.value

            // Update last received row ID
            const rowId = (row.id as number).toString().padStart(20, `0`)
            if (rowId > lastReceivedRowId) {
              lastReceivedRowId = rowId
            }

            // Emit raw data
            if (row.data && !isClosed) {
              controller.enqueue(encoder.encode(row.data as string))
            }

            // Check after EACH row if we should close
            maybeClose()
          }

          // Persist state for resumption (shape offsets, not row IDs)
          if (!isClosed) {
            setActiveGeneration(
              sessionId,
              responseData,
              dataStream.shapeHandle!,
              dataStream.lastOffset,
              controlStream.shapeHandle!,
              controlStream.lastOffset,
              lastReceivedRowId
            )
          }
        })

        // Subscribe to control stream
        controlUnsubscribe = controlStream.subscribe((messages: Message[]) => {
          if (isClosed) return

          for (const msg of messages) {
            if (isClosed) break

            const isControlMessage = `control` in msg.headers
            if (isControlMessage) continue

            const changeMsg = msg as ChangeMessage<Record<string, unknown>>
            const row = changeMsg.value
            const event = row.event as string
            const dataRowId = row.data_row_id as string

            if (event === `done`) {
              closeAfterRowId = dataRowId
              pendingClose = { type: `done` }
              maybeClose()
            }

            if (event === `error`) {
              closeAfterRowId = dataRowId
              const payload = row.payload as { message?: string } | null
              pendingClose = {
                type: `error`,
                message: payload?.message || `Stream error`,
              }
              maybeClose()
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
