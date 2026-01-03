/**
 * Auth utilities for session management.
 */

const SESSION_ID_KEY = 'durable-session-id'
const USERNAME_KEY = 'durable-session-username'

export interface StoredSession {
  sessionId: string
  username: string
}

/**
 * Get stored session from localStorage.
 */
export function getStoredSession(): StoredSession | null {
  if (typeof window === 'undefined') return null

  const sessionId = localStorage.getItem(SESSION_ID_KEY)
  const username = localStorage.getItem(USERNAME_KEY)

  if (!sessionId || !username) return null

  return { sessionId, username }
}

/**
 * Store session in localStorage.
 */
export function setStoredSession(sessionId: string, username: string): void {
  if (typeof window === 'undefined') return

  localStorage.setItem(SESSION_ID_KEY, sessionId)
  localStorage.setItem(USERNAME_KEY, username)
}

/**
 * Clear stored session from localStorage.
 */
export function clearStoredSession(): void {
  if (typeof window === 'undefined') return

  localStorage.removeItem(SESSION_ID_KEY)
  localStorage.removeItem(USERNAME_KEY)
}

/**
 * Check if user is logged in.
 */
export function isLoggedIn(): boolean {
  return getStoredSession() !== null
}
