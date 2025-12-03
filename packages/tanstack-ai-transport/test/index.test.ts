import { beforeEach, describe, expect, it, vi } from 'vitest'
import { durableTransport } from '../src/index'
import * as tanstackAiClient from '@tanstack/ai-client'
import * as transport from '@electric-sql/transport'

// Mock dependencies
vi.mock(`@tanstack/ai-client`, () => ({
  fetchServerSentEvents: vi.fn(() => ({ connect: vi.fn() })),
}))

vi.mock(`@electric-sql/transport`, () => ({
  createFetchClient: vi.fn(() => vi.fn()),
  getPersistedMessages: vi.fn(() => []),
  setPersistedMessages: vi.fn(),
  getActiveGeneration: vi.fn(() => null),
  clearActiveGeneration: vi.fn(),
  clearSession: vi.fn(),
  toUUID: vi.fn((id: string) => `uuid-${id}`),
}))

describe(`durableTransport`, () => {
  const sessionId = `test-session`
  const proxyUrl = `http://localhost:4000/api`

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe(`return value`, () => {
    it(`returns durableSession, initialMessages, and clearSession`, () => {
      const result = durableTransport(sessionId, { proxyUrl })

      expect(result).toHaveProperty(`durableSession`)
      expect(result).toHaveProperty(`initialMessages`)
      expect(result).toHaveProperty(`clearSession`)
      expect(typeof result.clearSession).toBe(`function`)
    })

    it(`durableSession contains id, connection, and onFinish`, () => {
      const result = durableTransport(sessionId, { proxyUrl })

      expect(result.durableSession).toHaveProperty(`id`, sessionId)
      expect(result.durableSession).toHaveProperty(`connection`)
      expect(result.durableSession).toHaveProperty(`onFinish`)
      expect(typeof result.durableSession.onFinish).toBe(`function`)
    })
  })

  describe(`fetch client`, () => {
    it(`creates fetch client with proxyUrl`, () => {
      durableTransport(sessionId, { proxyUrl })

      expect(transport.createFetchClient).toHaveBeenCalledWith({
        proxyUrl,
        auth: undefined,
      })
    })

    it(`passes auth to fetch client`, () => {
      const auth = { Authorization: `Bearer token` }
      durableTransport(sessionId, { proxyUrl, auth })

      expect(transport.createFetchClient).toHaveBeenCalledWith({
        proxyUrl,
        auth,
      })
    })

    it(`passes fetch client to fetchServerSentEvents`, () => {
      const mockFetchClient = vi.fn()
      vi.mocked(transport.createFetchClient).mockReturnValue(mockFetchClient)

      durableTransport(sessionId, { proxyUrl, api: `/api/chat` })

      expect(tanstackAiClient.fetchServerSentEvents).toHaveBeenCalledWith(
        `/api/chat`,
        expect.any(Function)
      )

      // Call the options function to verify it returns fetchClient
      const optionsFn = vi.mocked(tanstackAiClient.fetchServerSentEvents).mock
        .calls[0][1] as () => { fetchClient: typeof mockFetchClient }
      const options = optionsFn()
      expect(options.fetchClient).toBe(mockFetchClient)
    })
  })

  describe(`session headers`, () => {
    it(`includes X-Session-ID header`, () => {
      durableTransport(sessionId, { proxyUrl })

      const optionsFn = vi.mocked(tanstackAiClient.fetchServerSentEvents).mock
        .calls[0][1] as () => { headers: Record<string, string> }
      const options = optionsFn()

      expect(options.headers[`X-Session-ID`]).toBe(`uuid-${sessionId}`)
    })

    it(`includes resume headers when active generation exists`, () => {
      vi.mocked(transport.getActiveGeneration).mockReturnValue({
        data: { requestId: `req-123` },
        timestamp: Date.now(),
      })

      durableTransport(sessionId, { proxyUrl })

      const optionsFn = vi.mocked(tanstackAiClient.fetchServerSentEvents).mock
        .calls[0][1] as () => { headers: Record<string, string> }
      const options = optionsFn()

      expect(options.headers[`X-Resume-Active-Generation`]).toBe(`true`)
      expect(options.headers[`X-Replay-From-Start`]).toBe(`true`)
    })

    it(`omits resume headers when no active generation`, () => {
      vi.mocked(transport.getActiveGeneration).mockReturnValue(null)

      durableTransport(sessionId, { proxyUrl })

      const optionsFn = vi.mocked(tanstackAiClient.fetchServerSentEvents).mock
        .calls[0][1] as () => { headers: Record<string, string> }
      const options = optionsFn()

      expect(options.headers[`X-Resume-Active-Generation`]).toBeUndefined()
      expect(options.headers[`X-Replay-From-Start`]).toBeUndefined()
    })
  })

  describe(`initialMessages`, () => {
    it(`returns persisted messages`, () => {
      const messages = [{ id: `1`, role: `user`, parts: [] }]
      vi.mocked(transport.getPersistedMessages).mockReturnValue(messages)

      const result = durableTransport(sessionId, { proxyUrl })

      expect(result.initialMessages).toBe(messages)
    })

    it(`respects messages TTL option`, () => {
      durableTransport(sessionId, { proxyUrl }, { messages: { ttlMs: 3600000 } })

      expect(transport.getPersistedMessages).toHaveBeenCalledWith(
        sessionId,
        3600000
      )
    })
  })

  describe(`onFinish callback`, () => {
    it(`persists message and clears active generation`, () => {
      const existingMessages = [{ id: `1`, role: `user`, parts: [] }]
      vi.mocked(transport.getPersistedMessages).mockReturnValue(existingMessages)

      const result = durableTransport(sessionId, { proxyUrl })
      const newMessage = { id: `2`, role: `assistant`, parts: [] }

      result.durableSession.onFinish(newMessage as any)

      expect(transport.setPersistedMessages).toHaveBeenCalledWith(sessionId, [
        ...existingMessages,
        newMessage,
      ])
      expect(transport.clearActiveGeneration).toHaveBeenCalledWith(sessionId)
    })

    it(`calls user onFinish callback`, () => {
      const userOnFinish = vi.fn()
      const result = durableTransport(
        sessionId,
        { proxyUrl },
        { onFinish: userOnFinish }
      )
      const message = { id: `1`, role: `assistant`, parts: [] }

      result.durableSession.onFinish(message as any)

      expect(userOnFinish).toHaveBeenCalledWith(message)
    })
  })

  describe(`clearSession`, () => {
    it(`calls transport clearSession`, () => {
      const result = durableTransport(sessionId, { proxyUrl })

      result.clearSession()

      expect(transport.clearSession).toHaveBeenCalledWith(sessionId)
    })
  })

  describe(`api option`, () => {
    it(`uses default /api/chat when not provided`, () => {
      durableTransport(sessionId, { proxyUrl })

      expect(tanstackAiClient.fetchServerSentEvents).toHaveBeenCalledWith(
        `/api/chat`,
        expect.any(Function)
      )
    })

    it(`uses provided api string`, () => {
      durableTransport(sessionId, { proxyUrl, api: `/custom/endpoint` })

      expect(tanstackAiClient.fetchServerSentEvents).toHaveBeenCalledWith(
        `/custom/endpoint`,
        expect.any(Function)
      )
    })

    it(`uses provided api function`, () => {
      const apiFn = () => `/dynamic/endpoint`
      durableTransport(sessionId, { proxyUrl, api: apiFn })

      expect(tanstackAiClient.fetchServerSentEvents).toHaveBeenCalledWith(
        apiFn,
        expect.any(Function)
      )
    })
  })
})
