import type { Readable } from 'stream'
import { DurableStream } from '@durable-streams/client'
import { durableStreamsUrl, proxyUrl } from '../config'
import type { APIRequestParams, APIRequestHeaders } from '../schema'

export type APIResponse = {
  sessionId: string
  requestId: string
  streamUrl: string
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
 * Process a streaming API response by relaying raw chunks to a Durable Stream.
 *
 * Uses a buffer accumulation pattern that maximizes throughput:
 * - Consumes the HTTP stream as fast as possible
 * - Writes to Durable Stream as fast as it allows
 * - Accumulates chunks in memory while a write is in progress
 * - When write completes, flushes accumulated buffer
 *
 * This is protocol-agnostic: we wrap raw bytes in JSON events without parsing.
 *
 * Event types written to the stream:
 * - { type: "data", payload: string } - raw SSE chunk from upstream
 * - { type: "done", finishReason: string } - stream completed
 * - { type: "error", message: string } - stream error
 */
async function processApiResponse(
  stream: DurableStream,
  body: ReadableStream<Uint8Array>
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()

  let buffer = ``
  let writeInProgress: Promise<void> | null = null

  const flush = (): void => {
    if (writeInProgress !== null || buffer.length === 0) return

    const chunk = buffer
    buffer = ``

    writeInProgress = stream
      .append({ type: `data`, payload: chunk })
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

    // Write done event
    await stream.append({ type: `done`, finishReason: `complete` })
  } catch (error) {
    const message = error instanceof Error ? error.message : `Unknown error`
    await stream.append({ type: `error`, message })
    throw error
  }
}

/**
 * Handle API requests by proxying to the upstream API and streaming the response
 * to a Durable Stream.
 *
 * This handler is protocol-agnostic:
 * - Streams the request body directly to the upstream API without parsing
 * - Forwards headers as-is (client sets Content-Type)
 * - Relays raw response bytes to the Durable Stream as JSON events
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
    duplex: `half`,
  })

  if (!response.ok) {
    return {
      status: `error`,
      response,
    }
  }

  // Create the Durable Stream for this request
  const streamUrl = `${durableStreamsUrl}/stream/${sessionId}/${requestId}`
  const stream = await DurableStream.create({
    url: streamUrl,
    contentType: `application/json`,
  })

  if (response.body) {
    // Process the response stream in the background
    // Errors are handled inside processApiResponse (writes error event to stream)
    processApiResponse(stream, response.body).catch(() => {})
  } else {
    // No body - write done event immediately
    stream.append({ type: `done`, finishReason: `complete` }).catch(() => {})
  }

  return {
    sessionId,
    requestId,
    streamUrl,
    contentType: response.headers.get(`Content-Type`) ?? undefined,
  }
}
