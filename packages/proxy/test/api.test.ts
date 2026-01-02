import { Readable } from 'stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DurableStream } from '@durable-streams/client'
import { handleApiRequest, type APIRequestData } from '../src/handlers/api'

// Mock the DurableStream client
vi.mock(`@durable-streams/client`, () => ({
  DurableStream: {
    create: vi.fn(),
  },
}))

function createSSEStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${line}\n`))
      }
      controller.close()
    },
  })
}

function createReadableFromString(content: string): Readable {
  return Readable.from([content])
}

function createTestRequest(
  overrides: Partial<{
    sessionId: string
    requestId: string
    url: string
    method: string
    headers: Record<string, string>
    body: string
  }> = {}
): APIRequestData {
  return {
    params: {
      sessionId: overrides.sessionId ?? `00000000-0000-0000-0000-000000000001`,
      requestId: overrides.requestId ?? `00000000-0000-0000-0000-000000000002`,
    },
    proxyHeaders: {
      'x-proxy-url': overrides.url ?? `http://api.example.com/chat`,
      'x-proxy-method': (overrides.method ?? `POST`) as `POST`,
    },
    forwardHeaders: overrides.headers ?? { 'content-type': `application/json` },
    body: createReadableFromString(
      overrides.body ?? JSON.stringify({ messages: [] })
    ),
  }
}

describe(`handleApiRequest`, () => {
  let mockAppend: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(`fetch`, vi.fn())

    // Setup the mock for each test
    mockAppend = vi.fn().mockResolvedValue(undefined)
    vi.mocked(DurableStream.create).mockResolvedValue({
      append: mockAppend,
    } as unknown as ReturnType<typeof DurableStream.create>)
  })

  it(`returns stream metadata immediately with streamUrl (no controlUrl)`, async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(createSSEStream([])))

    const result = await handleApiRequest(createTestRequest())

    expect(result).toMatchObject({
      sessionId: `00000000-0000-0000-0000-000000000001`,
      requestId: `00000000-0000-0000-0000-000000000002`,
      streamUrl: expect.stringContaining(`/stream/`),
    })

    // Should NOT have controlUrl
    expect(result).not.toHaveProperty(`controlUrl`)

    // Wait for background processing to complete
    await new Promise((resolve) => setTimeout(resolve, 100))
  })

  it(`forwards request to backend with correct params`, async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(createSSEStream([])))

    await handleApiRequest(
      createTestRequest({
        headers: {
          'content-type': `application/json`,
          'x-custom': `test`,
        },
        body: JSON.stringify({
          messages: [{ role: `user`, content: `Hello` }],
        }),
      })
    )

    expect(fetch).toHaveBeenCalledWith(
      `http://api.example.com/chat`,
      expect.objectContaining({
        method: `POST`,
        headers: expect.objectContaining({
          'content-type': `application/json`,
          'x-custom': `test`,
        }),
        duplex: `half`,
      })
    )

    // Wait for background processing to complete
    await new Promise((resolve) => setTimeout(resolve, 100))
  })

  it(`creates a DurableStream and appends data events`, async () => {
    const chunks = [
      `data: {"type":"start","messageId":"msg-1"}`,
      `data: {"type":"text-delta","id":"msg-1","delta":"Hello"}`,
      `data: [DONE]`,
    ]

    vi.mocked(fetch).mockResolvedValue(new Response(createSSEStream(chunks)))

    await handleApiRequest(createTestRequest())

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 200))

    // DurableStream.create should have been called
    expect(DurableStream.create).toHaveBeenCalledWith({
      url: expect.stringContaining(`/stream/00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002`),
      contentType: `application/json`,
    })

    // Should have appended data events and a done event
    const appendCalls = mockAppend.mock.calls
    expect(appendCalls.length).toBeGreaterThanOrEqual(1)

    // Last call should be the done event
    const lastCall = appendCalls[appendCalls.length - 1][0]
    expect(lastCall).toEqual({ type: `done`, finishReason: `complete` })

    // At least one data event should have been appended
    const dataEvents = appendCalls.filter((call) => call[0].type === `data`)
    expect(dataEvents.length).toBeGreaterThanOrEqual(1)
  })

  it(`preserves raw content in data event payloads`, async () => {
    const chunks = [`{"type":"text-delta","id":"msg-1","delta":"test"}`]

    vi.mocked(fetch).mockResolvedValue(new Response(createSSEStream(chunks)))

    await handleApiRequest(createTestRequest())

    await new Promise((resolve) => setTimeout(resolve, 100))

    // Find data events in append calls
    const dataEvents = mockAppend.mock.calls.filter(
      (call) => call[0].type === `data`
    )
    expect(dataEvents.length).toBeGreaterThanOrEqual(1)

    // Combine all payloads and verify content is preserved
    const allPayloads = dataEvents.map((call) => call[0].payload).join(``)
    expect(allPayloads).toContain(
      `{"type":"text-delta","id":"msg-1","delta":"test"}`
    )
  })

  it(`returns error response when backend fails`, async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(`Internal Server Error`, { status: 500 })
    )

    const result = await handleApiRequest(createTestRequest())

    expect(result).toMatchObject({
      status: `error`,
      response: expect.any(Response),
    })
  })

  it(`writes error event when stream fails`, async () => {
    const errorStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: {"type":"start"}\n`))
        controller.error(new Error(`Connection reset`))
      },
    })

    vi.mocked(fetch).mockResolvedValue(new Response(errorStream))

    await handleApiRequest(createTestRequest())

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Check that an error event was written
    const errorEvents = mockAppend.mock.calls.filter(
      (call) => call[0].type === `error`
    )
    expect(errorEvents.length).toBe(1)
    expect(errorEvents[0][0].message).toContain(`Connection reset`)
  })

  it(`writes done event for empty stream`, async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(createSSEStream([])))

    await handleApiRequest(createTestRequest())

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Should have written a done event even with no data
    const doneEvents = mockAppend.mock.calls.filter(
      (call) => call[0].type === `done`
    )
    expect(doneEvents.length).toBe(1)
    expect(doneEvents[0][0]).toEqual({ type: `done`, finishReason: `complete` })
  })
})
