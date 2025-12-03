import { getActiveGeneration } from './storage'
import {
  create,
  read,
  resume,
  type CreateRequest,
  type ProxyError,
  type StreamResult,
} from './stream'

type AuthHeaders = Record<string, string>

export type FetchClientOptions = {
  proxyUrl: string
  auth?: AuthHeaders
}

type FetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

function isProxyError(error: unknown): error is ProxyError {
  return (
    error instanceof Error &&
    `response` in error &&
    error.response instanceof Response
  )
}

function getOrGenerateId(headers: Headers, headerName: string): string {
  const value = headers.get(headerName)

  if (value !== null) {
    return value
  }

  return crypto.randomUUID()
}

// Headers to strip when forwarding to upstream API
const TRANSPORT_HEADERS_TO_STRIP = new Set([
  `x-request-id`,
  `x-session-id`,
  `x-resume-active-generation`,
  `x-replay-from-start`,
  `x-active-generation-ttl`,
  `host`,
  `connection`,
  `content-length`,
  `transfer-encoding`,
])

function extractForwardHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}

  headers.forEach((value, key) => {
    if (TRANSPORT_HEADERS_TO_STRIP.has(key.toLowerCase())) return
    result[key] = value
  })

  return result
}

// Create a fetch-compatible client that routes requests through the transport proxy.
//
// The client intercepts fetch calls and:
// 1. Extracts or generates requestId and sessionId from `X-Request-ID` and `X-Session-ID` headers
// 2. Forwards the request to the proxy which handles the actual API call
// 3. Returns a streaming response via Electric's shape stream
//
// If the request has a `X-Resume-Active-Generation` header then the client tries to lookup
// an active generation for the `X-Session-ID`. If this exists, then the client resumes using
// the persisted stream handle and offset.
//
// Usage:
//   const fetch = createFetchClient({ proxyUrl: 'http://localhost:4000/api' })
//   const response = await fetch('https://api.openai.com/v1/chat/completions', {
//     method: 'POST',
//     headers: {
//       'Content-Type': 'application/json',
//       'X-Session-ID': sessionId  // optional, generated if not provided
//     },
//     body: JSON.stringify({ messages: [...] })
//   })
export function createFetchClient(options: FetchClientOptions): FetchFn {
  const { proxyUrl, auth = {} } = options

  return async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    // Normalize input to a Request object for consistent handling
    const request = new Request(input, init)
    const sessionId = getOrGenerateId(request.headers, `X-Session-ID`)

    let requestId: string
    let streamResult: StreamResult

    const shouldResumeActiveGeneration = request.headers.has(
      `X-Resume-Active-Generation`
    )
    if (shouldResumeActiveGeneration) {
      const replayFromStart = request.headers.get(`X-Replay-From-Start`) === `true`
      const ttlHeader = request.headers.get(`X-Active-Generation-TTL`)
      const ttlMs = ttlHeader !== null ? parseInt(ttlHeader, 10) : undefined

      const activeGeneration = getActiveGeneration(sessionId, ttlMs)
      if (activeGeneration === null) {
        return new Response(null, { status: 204 })
      }
      requestId = activeGeneration.data.requestId
      streamResult = await resume(activeGeneration, { replayFromStart })
    } else {
      requestId = getOrGenerateId(request.headers, `X-Request-ID`)

      const body = await request.text()
      const createRequest: CreateRequest = {
        sessionId,
        requestId,
        targetUrl: request.url,
        method: request.method,
        headers: extractForwardHeaders(request.headers),
        body: body || null
      }

      try {
        streamResult = await create(proxyUrl, createRequest, auth)
      } catch (error) {
        if (isProxyError(error)) {
          return error.response
        }

        throw error
      }
    }

    const {
      dataStream,
      controlStream,
      cleanup,
      sessionId: streamSessionId,
      responseData,
    } = streamResult

    const body = await read(
      dataStream,
      controlStream,
      cleanup,
      streamSessionId,
      responseData
    )

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': responseData.contentType ?? `application/octet-stream`,
        'Cache-Control': `no-cache`,
        Connection: `keep-alive`,
        'X-Request-ID': requestId,
        'X-Session-ID': sessionId,
      },
    })
  }
}
