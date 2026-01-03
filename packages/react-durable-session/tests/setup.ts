/**
 * Test setup for @electric-sql/react-durable-session
 *
 * Configures jsdom environment and extends vitest with jest-dom matchers.
 */

import '@testing-library/jest-dom/vitest'

/**
 * Suppress React act() warnings from useSyncExternalStore subscriptions.
 *
 * The useDurableChat hook uses useSyncExternalStore to subscribe to TanStack DB
 * collections. When external store subscription callbacks fire (e.g., when
 * markReady() is called during connection), they trigger React state updates.
 * These updates originate from outside React's normal update cycle, so React
 * logs act() warnings even though the updates are handled correctly.
 *
 * This is a known limitation when testing hooks that use useSyncExternalStore
 * with external data sources. The hook behavior is correct - these warnings
 * are false positives. See: https://github.com/testing-library/react-testing-library/issues/1061
 */
const originalError = console.error
console.error = (...args: unknown[]) => {
  const message = typeof args[0] === 'string' ? args[0] : ''
  if (message.includes('was not wrapped in act')) {
    return
  }
  originalError.apply(console, args)
}
