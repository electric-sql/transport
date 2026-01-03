import cors from 'cors'
import express from 'express'

import { proxyPort, proxyUrl } from './config'
import { handleApiRequest } from './handlers'
import { apiRequestParamsSchema, apiRequestHeadersSchema } from './schema'

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

const server = app.listen(proxyPort, () => {
  console.log(`Server running on ${proxyUrl}`)
})

const gracefulShutdown = (signal: string) => {
  console.log(`${signal} received, closing server gracefully...`)

  server.close(() => {
    process.exit(0)
  })

  setTimeout(() => {
    process.exit(1)
  }, 60_000)
}

process.on(`SIGTERM`, () => gracefulShutdown(`SIGTERM`))
process.on(`SIGINT`, () => gracefulShutdown(`SIGINT`))
