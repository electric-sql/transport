import cors from 'cors'
import express from 'express'
import { Readable } from 'stream'
import type { ReadableStream as WebReadableStream } from 'stream/web'

import { proxyPort, proxyUrl } from './config'
import {
  handleApiRequest,
  handleDataStreamRequest,
  handleControlStreamRequest,
} from './handlers'
import {
  apiRequestParamsSchema,
  apiRequestHeadersSchema,
  streamRequestSchema,
} from './schema'

import { applyMigrations, pool } from './db'
await applyMigrations()

const app = express()
app.use(cors())

// Health check
app.get(`/health`, (req, res) => {
  res.json({ status: `ok`, timestamp: Date.now() })
})

// Headers to strip when forwarding to upstream API
const PROXY_HEADERS_TO_STRIP = new Set([
  `host`,
  `connection`,
  `content-length`,
  `transfer-encoding`,
  `x-proxy-url`,
  `x-proxy-method`,
])

function extractForwardHeaders(
  headers: express.Request[`headers`]
): Record<string, string> {
  const result: Record<string, string> = {}

  for (const [key, value] of Object.entries(headers)) {
    if (PROXY_HEADERS_TO_STRIP.has(key.toLowerCase())) continue
    if (value === undefined) continue

    // Handle array values (e.g., multiple cookies)
    result[key] = Array.isArray(value) ? value.join(`, `) : value
  }

  return result
}

// Proxy requests to the developer's backend API.
// Path: /api/:sessionId/:requestId
// Headers: X-Proxy-Url (required), X-Proxy-Method (optional, defaults to POST)
// Body: raw stream passed through to upstream
app.post(`/api/:sessionId/:requestId`, async (req, res) => {
  const paramsResult = apiRequestParamsSchema.safeParse(req.params)
  if (!paramsResult.success) {
    return res.status(400).json({
      error: `Invalid path parameters`,
      details: paramsResult.error.errors,
    })
  }

  const headersResult = apiRequestHeadersSchema.safeParse(req.headers)
  if (!headersResult.success) {
    return res.status(400).json({
      error: `Invalid proxy headers`,
      details: headersResult.error.errors,
    })
  }

  const responseData = await handleApiRequest({
    params: paramsResult.data,
    proxyHeaders: headersResult.data,
    forwardHeaders: extractForwardHeaders(req.headers),
    body: req,
  })

  if (`status` in responseData && responseData.status === `error`) {
    return res.status(responseData.response.status).json({
      error: `Upstream API error`,
      status: responseData.response.status,
    })
  }

  res.json(responseData)
})

// Helper to pipe a fetch response to Express response
function pipeResponse(fetchResponse: Response, res: express.Response): void {
  res.status(fetchResponse.status)

  const headers = new Headers(fetchResponse.headers)
  headers.delete(`content-encoding`)
  headers.delete(`content-length`)
  headers.forEach((value, key) => {
    res.setHeader(key, value)
  })

  if (fetchResponse.body) {
    Readable.fromWeb(fetchResponse.body as WebReadableStream).pipe(res)
  } else {
    res.end()
  }
}

// Proxy requests to Electric for data stream.
app.get(`/stream/data`, async (req, res) => {
  const result = streamRequestSchema.safeParse(req.query)

  if (!result.success) {
    return res.status(400).json({
      error: `Invalid`,
      details: result.error.errors,
    })
  }

  const response = await handleDataStreamRequest(result.data)
  pipeResponse(response, res)
})

// Proxy requests to Electric for control stream.
app.get(`/stream/control`, async (req, res) => {
  const result = streamRequestSchema.safeParse(req.query)

  if (!result.success) {
    return res.status(400).json({
      error: `Invalid`,
      details: result.error.errors,
    })
  }

  const response = await handleControlStreamRequest(result.data)
  pipeResponse(response, res)
})

const server = app.listen(proxyPort, () => {
  console.log(`Server running on ${proxyUrl}`)
})

const gracefulShutdown = (signal: string) => {
  console.log(`${signal} received, closing server gracefully...`)

  server.close(() => {
    pool.end()

    process.exit(0)
  })

  setTimeout(() => {
    process.exit(1)
  }, 60_000)
}

process.on(`SIGTERM`, () => gracefulShutdown(`SIGTERM`))
process.on(`SIGINT`, () => gracefulShutdown(`SIGINT`))
