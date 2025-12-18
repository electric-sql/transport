/**
 * AI DB Proxy Server
 *
 * Hono-based HTTP server implementing the AI DB Wrapper Protocol.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { AIDBSessionProtocol } from './protocol'
import {
  createSessionRoutes,
  createMessageRoutes,
  createAgentRoutes,
  createToolResultRoutes,
  createApprovalRoutes,
  createForkRoutes,
  createHealthRoutes,
  createStreamRoutes,
  PROTOCOL_RESPONSE_HEADERS,
} from './routes'
import type { AIDBProtocolOptions } from './types'

/**
 * Options for creating the AI DB proxy server.
 */
export interface AIDBProxyServerOptions extends AIDBProtocolOptions {
  /** Enable CORS */
  cors?: boolean
  /** Enable request logging */
  logging?: boolean
  /** Custom CORS origins */
  corsOrigins?: string | string[]
}

/**
 * Create the AI DB proxy server.
 *
 * @example
 * ```typescript
 * import { createServer } from '@electric-sql/ai-db-proxy'
 *
 * const app = createServer({
 *   baseUrl: 'http://localhost:3000',
 * })
 *
 * // Use with Node.js
 * import { serve } from '@hono/node-server'
 * serve({ fetch: app.fetch, port: 4000 })
 *
 * // Or use with Cloudflare Workers
 * export default app
 * ```
 */
export function createServer(options: AIDBProxyServerOptions) {
  const app = new Hono()

  // Create protocol instance
  const protocol = new AIDBSessionProtocol({
    baseUrl: options.baseUrl,
    storage: options.storage,
  })

  // Middleware
  if (options.cors !== false) {
    app.use(
      '*',
      cors({
        origin: options.corsOrigins ?? '*',
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Actor-Id',
          'X-Actor-Type',
          'X-Session-Id',
        ],
        // Expose Durable Streams protocol headers to browser clients
        exposeHeaders: [...PROTOCOL_RESPONSE_HEADERS],
      })
    )
  }

  if (options.logging !== false) {
    app.use('*', logger())
  }

  // Health routes
  app.route('/health', createHealthRoutes())

  // API v1 routes
  const v1 = new Hono()

  // Session management
  v1.route('/sessions', createSessionRoutes(protocol))

  // Messages (nested under sessions)
  v1.route('/sessions', createMessageRoutes(protocol))

  // Agents (nested under sessions)
  v1.route('/sessions', createAgentRoutes(protocol))

  // Tool results (nested under sessions)
  v1.route('/sessions', createToolResultRoutes(protocol))

  // Approvals (nested under sessions)
  v1.route('/sessions', createApprovalRoutes(protocol))

  // Fork (nested under sessions)
  v1.route('/sessions', createForkRoutes(protocol))

  // Stream proxy - forwards to Durable Streams server
  v1.route('/stream', createStreamRoutes(options.baseUrl))

  app.route('/v1', v1)

  // Root info
  app.get('/', (c) => {
    return c.json({
      name: '@electric-sql/ai-db-proxy',
      version: '0.1.0',
      endpoints: {
        health: '/health',
        stream: '/v1/stream/sessions/:sessionId',
        sessions: '/v1/sessions/:sessionId',
        messages: '/v1/sessions/:sessionId/messages',
        agents: '/v1/sessions/:sessionId/agents',
        toolResults: '/v1/sessions/:sessionId/tool-results',
        approvals: '/v1/sessions/:sessionId/approvals/:approvalId',
        fork: '/v1/sessions/:sessionId/fork',
        stop: '/v1/sessions/:sessionId/stop',
        regenerate: '/v1/sessions/:sessionId/regenerate',
      },
    })
  })

  return { app, protocol }
}

/**
 * Default export for the server app factory.
 */
export default createServer
