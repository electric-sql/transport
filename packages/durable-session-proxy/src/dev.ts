/**
 * Development server for AI DB Proxy.
 *
 * Starts the proxy server with default configuration for local development.
 */

import { serve } from '@hono/node-server'
import { createServer } from './server'

const PORT = parseInt(process.env.PORT ?? '4000', 10)
const DURABLE_STREAMS_URL = process.env.DURABLE_STREAMS_URL ?? 'http://localhost:3001'

const { app } = createServer({
  baseUrl: DURABLE_STREAMS_URL,
  cors: true,
  logging: true,
})

console.log(`AI DB Proxy starting...`)
console.log(`  Port: ${PORT}`)
console.log(`  Durable Streams: ${DURABLE_STREAMS_URL}`)

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`AI DB Proxy running on http://localhost:${info.port}`)
})
