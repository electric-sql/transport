import type { APIRequest } from './schema'
import { getActiveGeneration } from './storage'
import {
  create,
  read,
  resume,
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

async function parseRequestBody(
  request: Request
): Promise<unknown | undefined> {
  const contentType = request.headers.get(`Content-Type`)

  if (contentType?.includes(`application/json`)) {
    const text = await request.text()

    if (text) {
      return JSON.parse(text)
    }
  }

  return undefined
}

function extractForwardHeaders(
  headers: Headers
): Record<string, string> | undefined {
  const result: Record<string, string> = {}
  let hasHeaders = false

  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase()

    // Skip transport-specific headers and standard hop-by-hop headers
    if (
      lowerKey === `x-request-id` ||
      lowerKey === `x-session-id` ||
      lowerKey === `host` ||
      lowerKey === `connection` ||
      lowerKey === `content-length` ||
      lowerKey === `transfer-encoding`
    ) {
      return
    }

    result[key] = value
    hasHeaders = true
  })

  return hasHeaders ? result : undefined
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
      const activeGeneration = getActiveGeneration(sessionId)

      if (activeGeneration === null) {
        return new Response(``, { status: 204 })
      }

      requestId = activeGeneration.data.requestId
      streamResult = await resume(activeGeneration)
    } else {
      requestId = getOrGenerateId(request.headers, `X-Request-ID`)

      const body = await parseRequestBody(request)
      const headers = extractForwardHeaders(request.headers)

      const apiRequest: APIRequest = {
        requestId,
        sessionId,
        url: request.url,
        method: request.method as APIRequest[`method`],
        headers,
        body,
      }

      try {
        streamResult = await create(proxyUrl, apiRequest, auth)
      } catch (error) {
        if (isProxyError(error)) {
          return error.response
        }

        throw error
      }
    }

    const {
      stream,
      cleanup,
      sessionId: streamSessionId,
      responseData,
    } = streamResult
    const body = await read(stream, cleanup, streamSessionId, responseData)

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': `text/event-stream`,
        'Cache-Control': `no-cache`,
        Connection: `keep-alive`,
        'X-Request-ID': requestId,
        'X-Session-ID': sessionId,
      },
    })
  }
}
