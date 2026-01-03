/**
 * Stream proxy routes - forwards stream read requests to the Durable Streams server.
 *
 * This route proxies GET requests for `/v1/stream/sessions/:sessionId` to the
 * upstream Durable Streams server, enabling clients to read from streams
 * without direct access to the backend.
 *
 * The proxy:
 * - Forwards protocol query parameters (offset, live, cursor)
 * - Streams responses without buffering
 * - Passes through protocol headers (Stream-Next-Offset, Stream-Cursor, etc.)
 */

import { Hono } from 'hono'
import {
  STREAM_OFFSET_HEADER,
  STREAM_CURSOR_HEADER,
  STREAM_UP_TO_DATE_HEADER,
  DURABLE_STREAM_PROTOCOL_QUERY_PARAMS,
} from '@durable-streams/client'

/**
 * Durable Streams Protocol response headers to pass through.
 */
export const PROTOCOL_RESPONSE_HEADERS = [
  STREAM_OFFSET_HEADER,
  STREAM_CURSOR_HEADER,
  STREAM_UP_TO_DATE_HEADER,
  'Content-Type',
  'Cache-Control',
  'ETag',
] as const

/**
 * Durable Streams Protocol query parameters to forward.
 */
const PROTOCOL_QUERY_PARAMS = DURABLE_STREAM_PROTOCOL_QUERY_PARAMS

/**
 * Headers to strip from proxied responses.
 */
const HEADERS_TO_STRIP = [
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
] as const

/**
 * Create stream proxy routes.
 *
 * @param baseUrl - The base URL of the Durable Streams server (e.g., http://localhost:3001)
 */
export function createStreamRoutes(baseUrl: string) {
  const app = new Hono()

  /**
   * GET /v1/stream/sessions/:sessionId
   *
   * Proxy stream read requests to the Durable Streams server.
   * Supports catch-up reads and live modes (long-poll, sse).
   */
  app.get('/sessions/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId')

    // Build upstream URL
    const upstreamUrl = new URL(`${baseUrl}/v1/stream/sessions/${sessionId}`)

    // Forward protocol query parameters
    for (const param of PROTOCOL_QUERY_PARAMS) {
      const value = c.req.query(param)
      if (value !== undefined) {
        upstreamUrl.searchParams.set(param, value)
      }
    }

    try {
      // Fetch from upstream Durable Streams server
      const upstreamResponse = await fetch(upstreamUrl.toString(), {
        method: 'GET',
        headers: {
          // Forward any auth headers from the client
          ...Object.fromEntries(
            [...c.req.raw.headers.entries()].filter(
              ([key]) =>
                key.toLowerCase() === 'authorization' ||
                key.toLowerCase().startsWith('x-')
            )
          ),
        },
      })

      // If upstream returns an error, pass it through
      if (!upstreamResponse.ok) {
        // For 404, return a cleaner error
        if (upstreamResponse.status === 404) {
          return c.json({ error: 'Stream not found' }, 404)
        }

        // For other errors, try to get error details
        const errorText = await upstreamResponse.text().catch(() => 'Unknown error')
        return c.json(
          {
            error: 'Upstream error',
            status: upstreamResponse.status,
            details: errorText,
          },
          upstreamResponse.status as 400 | 500
        )
      }

      // Build response headers - pass through protocol headers
      const responseHeaders = new Headers()

      for (const header of PROTOCOL_RESPONSE_HEADERS) {
        const value = upstreamResponse.headers.get(header)
        if (value !== null) {
          responseHeaders.set(header, value)
        }
      }

      // Handle empty responses (e.g., 204 No Content from long-poll timeout)
      if (upstreamResponse.status === 204) {
        // Pass through the Stream-Next-Offset header even on 204
        const nextOffset = upstreamResponse.headers.get(STREAM_OFFSET_HEADER)
        if (nextOffset) {
          c.header(STREAM_OFFSET_HEADER, nextOffset)
        }
        return c.body(null, 204)
      }

      // Stream the response body through without buffering
      if (!upstreamResponse.body) {
        // No body - return empty response with headers
        for (const [key, value] of responseHeaders.entries()) {
          c.header(key, value)
        }
        return c.body(null, upstreamResponse.status as 200)
      }

      // For streaming responses, we need to manually pipe and set headers
      // Use c.body() with the stream to let Hono handle the response properly
      for (const [key, value] of responseHeaders.entries()) {
        c.header(key, value)
      }
      c.status(upstreamResponse.status as 200)
      return c.body(upstreamResponse.body)
    } catch (error) {
      console.error('Stream proxy error:', error)
      return c.json(
        {
          error: 'Failed to proxy stream request',
          details: (error as Error).message,
        },
        502
      )
    }
  })

  return app
}
