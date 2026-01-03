/**
 * Health check routes.
 */

import { Hono } from 'hono'

/**
 * Create health check routes.
 */
export function createHealthRoutes() {
  const app = new Hono()

  /**
   * GET /health
   *
   * Health check endpoint.
   */
  app.get('/', (c) => {
    return c.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    })
  })

  /**
   * GET /health/ready
   *
   * Readiness check endpoint.
   */
  app.get('/ready', (c) => {
    return c.json({
      status: 'ready',
      timestamp: new Date().toISOString(),
    })
  })

  /**
   * GET /health/live
   *
   * Liveness check endpoint.
   */
  app.get('/live', (c) => {
    return c.json({
      status: 'live',
      timestamp: new Date().toISOString(),
    })
  })

  return app
}
