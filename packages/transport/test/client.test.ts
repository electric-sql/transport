import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFetchClient } from '../src/client'
import * as stream from '../src/stream'

// Mock the stream module
vi.mock(`../src/stream`, () => ({
  create: vi.fn(),
  read: vi.fn(),
}))

// Mock crypto.randomUUID for deterministic tests
const mockRandomUUID = vi.fn()
vi.stubGlobal(`crypto`, { randomUUID: mockRandomUUID })

describe(`createFetchClient`, () => {
  const proxyUrl = `http://localhost:4000/api`
  const mockCleanup = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    mockRandomUUID
      .mockReturnValueOnce(`generated-session-id`)
      .mockReturnValueOnce(`generated-request-id`)
  })

  describe(`header parsing`, () => {
    it(`uses provided X-Request-ID and X-Session-ID headers`, async () => {
      const mockStream = {}
      const mockBody = new ReadableStream()

      vi.mocked(stream.create).mockResolvedValue({
        stream: mockStream,
        cleanup: mockCleanup,
      })
      vi.mocked(stream.read).mockResolvedValue(mockBody)

      const fetch = createFetchClient({ proxyUrl })

      await fetch(`https://api.example.com/chat`, {
        method: `POST`,
        headers: {
          'X-Request-ID': `provided-request-id`,
          'X-Session-ID': `provided-session-id`,
          'Content-Type': `application/json`,
        },
        body: JSON.stringify({ messages: [] }),
      })

      expect(stream.create).toHaveBeenCalledWith(
        proxyUrl,
        expect.objectContaining({
          requestId: `provided-request-id`,
          sessionId: `provided-session-id`,
        }),
        {}
      )
    })

    it(`generates UUIDs when headers are not provided`, async () => {
      const mockStream = {}
      const mockBody = new ReadableStream()

      vi.mocked(stream.create).mockResolvedValue({
        stream: mockStream,
        cleanup: mockCleanup,
      })
      vi.mocked(stream.read).mockResolvedValue(mockBody)

      const fetch = createFetchClient({ proxyUrl })

      await fetch(`https://api.example.com/chat`, {
        method: `POST`,
        headers: {
          'Content-Type': `application/json`,
        },
        body: JSON.stringify({ messages: [] }),
      })

      expect(stream.create).toHaveBeenCalledWith(
        proxyUrl,
        expect.objectContaining({
          requestId: `generated-request-id`,
          sessionId: `generated-session-id`,
        }),
        {}
      )
    })

    it(`generates missing IDs individually`, async () => {
      const mockStream = {}
      const mockBody = new ReadableStream()

      vi.mocked(stream.create).mockResolvedValue({
        stream: mockStream,
        cleanup: mockCleanup,
      })
      vi.mocked(stream.read).mockResolvedValue(mockBody)

      const fetch = createFetchClient({ proxyUrl })

      // Only provide session ID - since sessionId is provided, only one UUID will be generated
      // Reset the mock to return the expected value on first (and only) call
      mockRandomUUID.mockReset()
      mockRandomUUID.mockReturnValueOnce(`generated-request-id`)

      await fetch(`https://api.example.com/chat`, {
        method: `POST`,
        headers: {
          'X-Session-ID': `provided-session-id`,
          'Content-Type': `application/json`,
        },
        body: JSON.stringify({ messages: [] }),
      })

      expect(stream.create).toHaveBeenCalledWith(
        proxyUrl,
        expect.objectContaining({
          requestId: `generated-request-id`,
          sessionId: `provided-session-id`,
        }),
        {}
      )
    })
  })

  describe(`request forwarding`, () => {
    it(`forwards URL correctly`, async () => {
      const mockStream = {}
      const mockBody = new ReadableStream()

      vi.mocked(stream.create).mockResolvedValue({
        stream: mockStream,
        cleanup: mockCleanup,
      })
      vi.mocked(stream.read).mockResolvedValue(mockBody)

      const fetch = createFetchClient({ proxyUrl })

      await fetch(`https://api.example.com/v1/chat/completions`, {
        method: `POST`,
        headers: { 'Content-Type': `application/json` },
        body: JSON.stringify({ model: `gpt-4` }),
      })

      expect(stream.create).toHaveBeenCalledWith(
        proxyUrl,
        expect.objectContaining({
          url: `https://api.example.com/v1/chat/completions`,
        }),
        {}
      )
    })

    it(`forwards HTTP method correctly`, async () => {
      const mockStream = {}
      const mockBody = new ReadableStream()

      vi.mocked(stream.create).mockResolvedValue({
        stream: mockStream,
        cleanup: mockCleanup,
      })
      vi.mocked(stream.read).mockResolvedValue(mockBody)

      const fetch = createFetchClient({ proxyUrl })

      await fetch(`https://api.example.com/resource`, {
        method: `PUT`,
        headers: { 'Content-Type': `application/json` },
        body: JSON.stringify({ data: `test` }),
      })

      expect(stream.create).toHaveBeenCalledWith(
        proxyUrl,
        expect.objectContaining({
          method: `PUT`,
        }),
        {}
      )
    })

    it(`forwards JSON body correctly`, async () => {
      const mockStream = {}
      const mockBody = new ReadableStream()

      vi.mocked(stream.create).mockResolvedValue({
        stream: mockStream,
        cleanup: mockCleanup,
      })
      vi.mocked(stream.read).mockResolvedValue(mockBody)

      const fetch = createFetchClient({ proxyUrl })
      const requestBody = {
        messages: [{ role: `user`, content: `Hello` }],
        model: `gpt-4`,
      }

      await fetch(`https://api.example.com/chat`, {
        method: `POST`,
        headers: { 'Content-Type': `application/json` },
        body: JSON.stringify(requestBody),
      })

      expect(stream.create).toHaveBeenCalledWith(
        proxyUrl,
        expect.objectContaining({
          body: requestBody,
        }),
        {}
      )
    })

    it(`forwards custom headers excluding transport headers`, async () => {
      const mockStream = {}
      const mockBody = new ReadableStream()

      vi.mocked(stream.create).mockResolvedValue({
        stream: mockStream,
        cleanup: mockCleanup,
      })
      vi.mocked(stream.read).mockResolvedValue(mockBody)

      const fetch = createFetchClient({ proxyUrl })

      await fetch(`https://api.example.com/chat`, {
        method: `POST`,
        headers: {
          'Content-Type': `application/json`,
          Authorization: `Bearer token123`,
          'X-Custom-Header': `custom-value`,
          'X-Request-ID': `should-be-excluded`,
          'X-Session-ID': `should-be-excluded`,
        },
        body: JSON.stringify({}),
      })

      const createCall = vi.mocked(stream.create).mock.calls[0]
      const apiRequest = createCall[1]

      // Headers API normalizes keys to lowercase
      expect(apiRequest.headers).toEqual({
        'content-type': `application/json`,
        authorization: `Bearer token123`,
        'x-custom-header': `custom-value`,
      })
      expect(apiRequest.headers).not.toHaveProperty(`X-Request-ID`)
      expect(apiRequest.headers).not.toHaveProperty(`X-Session-ID`)
    })

    it(`handles requests without body`, async () => {
      const mockStream = {}
      const mockBody = new ReadableStream()

      vi.mocked(stream.create).mockResolvedValue({
        stream: mockStream,
        cleanup: mockCleanup,
      })
      vi.mocked(stream.read).mockResolvedValue(mockBody)

      const fetch = createFetchClient({ proxyUrl })

      await fetch(`https://api.example.com/resource`, {
        method: `GET`,
      })

      expect(stream.create).toHaveBeenCalledWith(
        proxyUrl,
        expect.objectContaining({
          method: `GET`,
          body: undefined,
        }),
        {}
      )
    })
  })

  describe(`auth headers`, () => {
    it(`passes auth headers to create function`, async () => {
      const mockStream = {}
      const mockBody = new ReadableStream()

      vi.mocked(stream.create).mockResolvedValue({
        stream: mockStream,
        cleanup: mockCleanup,
      })
      vi.mocked(stream.read).mockResolvedValue(mockBody)

      const auth = { 'X-API-Key': `secret-key` }
      const fetch = createFetchClient({ proxyUrl, auth })

      await fetch(`https://api.example.com/chat`, {
        method: `POST`,
        headers: { 'Content-Type': `application/json` },
        body: JSON.stringify({}),
      })

      expect(stream.create).toHaveBeenCalledWith(
        proxyUrl,
        expect.any(Object),
        auth
      )
    })
  })

  describe(`successful response`, () => {
    it(`returns 200 response with streaming body`, async () => {
      const mockStream = {}
      const mockBody = new ReadableStream({
        start(controller) {
          controller.enqueue(`test chunk`)
          controller.close()
        },
      })

      vi.mocked(stream.create).mockResolvedValue({
        stream: mockStream,
        cleanup: mockCleanup,
      })
      vi.mocked(stream.read).mockResolvedValue(mockBody)

      const fetch = createFetchClient({ proxyUrl })

      const response = await fetch(`https://api.example.com/chat`, {
        method: `POST`,
        headers: {
          'X-Request-ID': `test-request-id`,
          'X-Session-ID': `test-session-id`,
          'Content-Type': `application/json`,
        },
        body: JSON.stringify({}),
      })

      expect(response.status).toBe(200)
      expect(response.headers.get(`Content-Type`)).toBe(`text/event-stream`)
      expect(response.headers.get(`X-Request-ID`)).toBe(`test-request-id`)
      expect(response.headers.get(`X-Session-ID`)).toBe(`test-session-id`)
      expect(response.body).toBe(mockBody)
    })

    it(`calls read with stream and cleanup from create`, async () => {
      const mockStream = { id: `test-stream` }
      const mockBody = new ReadableStream()

      vi.mocked(stream.create).mockResolvedValue({
        stream: mockStream,
        cleanup: mockCleanup,
      })
      vi.mocked(stream.read).mockResolvedValue(mockBody)

      const fetch = createFetchClient({ proxyUrl })

      await fetch(`https://api.example.com/chat`, {
        method: `POST`,
        headers: { 'Content-Type': `application/json` },
        body: JSON.stringify({}),
      })

      expect(stream.read).toHaveBeenCalledWith(mockStream, mockCleanup)
    })
  })

  describe(`error handling`, () => {
    it(`returns proxy error response when create fails with ProxyError`, async () => {
      const errorResponse = new Response(`Bad Request`, { status: 400 })
      const proxyError = new Error(`Proxy request failed`) as Error & {
        response: Response
      }
      proxyError.response = errorResponse

      vi.mocked(stream.create).mockRejectedValue(proxyError)

      const fetch = createFetchClient({ proxyUrl })

      const response = await fetch(`https://api.example.com/chat`, {
        method: `POST`,
        headers: { 'Content-Type': `application/json` },
        body: JSON.stringify({}),
      })

      expect(response).toBe(errorResponse)
      expect(response.status).toBe(400)
    })

    it(`returns 500 error response when create fails with server error`, async () => {
      const errorResponse = new Response(`Internal Server Error`, {
        status: 500,
      })
      const proxyError = new Error(`Proxy request failed`) as Error & {
        response: Response
      }
      proxyError.response = errorResponse

      vi.mocked(stream.create).mockRejectedValue(proxyError)

      const fetch = createFetchClient({ proxyUrl })

      const response = await fetch(`https://api.example.com/chat`, {
        method: `POST`,
        headers: { 'Content-Type': `application/json` },
        body: JSON.stringify({}),
      })

      expect(response.status).toBe(500)
    })

    it(`rethrows non-proxy errors`, async () => {
      const networkError = new Error(`Network error`)

      vi.mocked(stream.create).mockRejectedValue(networkError)

      const fetch = createFetchClient({ proxyUrl })

      await expect(
        fetch(`https://api.example.com/chat`, {
          method: `POST`,
          headers: { 'Content-Type': `application/json` },
          body: JSON.stringify({}),
        })
      ).rejects.toThrow(`Network error`)
    })

    it(`rethrows errors from read function`, async () => {
      const mockStream = {}

      vi.mocked(stream.create).mockResolvedValue({
        stream: mockStream,
        cleanup: mockCleanup,
      })
      vi.mocked(stream.read).mockRejectedValue(new Error(`Stream read error`))

      const fetch = createFetchClient({ proxyUrl })

      await expect(
        fetch(`https://api.example.com/chat`, {
          method: `POST`,
          headers: { 'Content-Type': `application/json` },
          body: JSON.stringify({}),
        })
      ).rejects.toThrow(`Stream read error`)
    })
  })

  describe(`input normalization`, () => {
    it(`handles URL object as input`, async () => {
      const mockStream = {}
      const mockBody = new ReadableStream()

      vi.mocked(stream.create).mockResolvedValue({
        stream: mockStream,
        cleanup: mockCleanup,
      })
      vi.mocked(stream.read).mockResolvedValue(mockBody)

      const fetch = createFetchClient({ proxyUrl })
      const url = new URL(`https://api.example.com/chat`)

      await fetch(url, {
        method: `POST`,
        headers: { 'Content-Type': `application/json` },
        body: JSON.stringify({}),
      })

      expect(stream.create).toHaveBeenCalledWith(
        proxyUrl,
        expect.objectContaining({
          url: `https://api.example.com/chat`,
        }),
        {}
      )
    })

    it(`handles Request object as input`, async () => {
      const mockStream = {}
      const mockBody = new ReadableStream()

      vi.mocked(stream.create).mockResolvedValue({
        stream: mockStream,
        cleanup: mockCleanup,
      })
      vi.mocked(stream.read).mockResolvedValue(mockBody)

      const fetch = createFetchClient({ proxyUrl })
      const request = new Request(`https://api.example.com/chat`, {
        method: `POST`,
        headers: {
          'Content-Type': `application/json`,
          'X-Request-ID': `from-request-object`,
        },
        body: JSON.stringify({ test: true }),
      })

      await fetch(request)

      expect(stream.create).toHaveBeenCalledWith(
        proxyUrl,
        expect.objectContaining({
          url: `https://api.example.com/chat`,
          method: `POST`,
          requestId: `from-request-object`,
          body: { test: true },
        }),
        {}
      )
    })

    it(`handles string URL as input`, async () => {
      const mockStream = {}
      const mockBody = new ReadableStream()

      vi.mocked(stream.create).mockResolvedValue({
        stream: mockStream,
        cleanup: mockCleanup,
      })
      vi.mocked(stream.read).mockResolvedValue(mockBody)

      const fetch = createFetchClient({ proxyUrl })

      await fetch(`https://api.example.com/chat`, {
        method: `POST`,
        headers: { 'Content-Type': `application/json` },
        body: JSON.stringify({}),
      })

      expect(stream.create).toHaveBeenCalledWith(
        proxyUrl,
        expect.objectContaining({
          url: `https://api.example.com/chat`,
        }),
        {}
      )
    })
  })
})
