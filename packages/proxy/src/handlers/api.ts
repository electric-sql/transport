import type { Readable } from 'stream'
import { proxyUrl } from '../config'
import { insertDataChunk, insertControlMessage } from '../db'
import type { APIRequestParams, APIRequestHeaders } from '../schema'

export type APIResponse = {
  sessionId: string
  requestId: string
  streamUrl: string
  controlUrl: string
  contentType?: string
}

export type ErrorResponse = {
  status: `error`
  response: Response
}

export type APIRequestData = {
  params: APIRequestParams
  proxyHeaders: APIRequestHeaders
  forwardHeaders: Record<string, string>
  body: Readable
}

/**
 * Process a streaming API response by relaying raw chunks to the database.
 *
 * Uses a buffer accumulation pattern that maximizes throughput:
 * - Consumes the HTTP stream as fast as possible
 * - Writes to DB as fast as the DB allows
 * - Accumulates chunks in memory while a write is in progress
 * - When write completes, flushes accumulated buffer as a single row
 *
 * This is protocol-agnostic: we relay raw bytes without parsing.
 *
 * Tracks the lastDataRowId for each insert to enable synchronization
 * between the data and control streams.
 */
async function processApiResponse(
  sessionId: string,
  requestId: string,
  body: ReadableStream<Uint8Array>
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()

  let buffer = ``
  let writeInProgress: Promise<string> | null = null
  let lastDataRowId: string = `0`.padStart(20, `0`)

  const flush = (): void => {
    if (writeInProgress !== null || buffer.length === 0) return

    const chunk = buffer
    buffer = ``

    writeInProgress = insertDataChunk(sessionId, requestId, chunk)
      .then((rowId) => {
        lastDataRowId = rowId
        return rowId
      })
      .finally(() => {
        writeInProgress = null
        flush()
      })
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      flush()
    }

    // Handle any remaining bytes from the decoder
    const remaining = decoder.decode()
    if (remaining) {
      buffer += remaining
    }

    // Wait for all writes to complete (flush may trigger additional writes in finally callback)
    while (writeInProgress !== null || buffer.length > 0) {
      if (writeInProgress !== null) {
        await writeInProgress
      }
      if (buffer.length > 0 && writeInProgress === null) {
        flush()
      }
    }

    // Write control message with final data row ID
    await insertControlMessage(sessionId, requestId, `done`, lastDataRowId, {
      finishReason: `complete`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : `Unknown error`
    await insertControlMessage(sessionId, requestId, `error`, lastDataRowId, {
      message,
    })
    throw error
  }
}

/**
 * Handle API requests by proxying to the upstream API and streaming the response to the database.
 *
 * This handler is protocol-agnostic:
 * - Streams the request body directly to the upstream API without parsing
 * - Forwards headers as-is (client sets Content-Type)
 * - Relays raw response bytes to the database
 *
 * Request format:
 * - Path: /api/:sessionId/:requestId
 * - Headers: X-Proxy-Url, X-Proxy-Method, plus any headers to forward
 * - Body: raw stream passed through to upstream
 */
export async function handleApiRequest(
  data: APIRequestData
): Promise<APIResponse | ErrorResponse> {
  const { params, proxyHeaders, forwardHeaders, body } = data
  const { sessionId, requestId } = params

  const url = proxyHeaders[`x-proxy-url`]
  const method = proxyHeaders[`x-proxy-method`]

  // Stream body directly to upstream API
  const response = await fetch(url, {
    method,
    body,
    headers: forwardHeaders,
    duplex: `half`
  })

  if (!response.ok) {
    return {
      status: `error`,
      response,
    }
  }

  if (response.body) {
    // Process the response stream in the background
    processApiResponse(sessionId, requestId, response.body).catch((error) => {
      console.error(`processApiResponse error`, { sessionId, requestId }, error)
    })
  }

  return {
    sessionId,
    requestId,
    streamUrl: `${proxyUrl}/stream/data`,
    controlUrl: `${proxyUrl}/stream/control`,
    contentType: response.headers.get(`Content-Type`) ?? undefined,
  }
}
