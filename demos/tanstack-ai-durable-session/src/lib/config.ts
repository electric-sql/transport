/**
 * Centralized configuration for the demo app.
 */

/**
 * AI DB Proxy URL (handles session management and agent invocation).
 */
export const proxyUrl =
  typeof window !== 'undefined'
    ? (window as unknown as { ENV?: { PROXY_URL?: string } }).ENV?.PROXY_URL ??
      'http://localhost:4000'
    : 'http://localhost:4000'

/**
 * Demo app URL (where our /api/chat endpoints live).
 */
export const appUrl =
  typeof window !== 'undefined'
    ? window.location.origin
    : process.env.APP_URL ?? 'http://localhost:5175'
