import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyMigrations, pool } from '../src/db'
import { handleApiRequest } from '../src/handlers/api'

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

describe(`handleApiRequest`, () => {
  beforeEach(async () => {
    await applyMigrations()
    await pool.query(`TRUNCATE chunks`)

    vi.stubGlobal(`fetch`, vi.fn())
  })

  it(`returns stream metadata immediately`, async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(createSSEStream([])))

    const result = await handleApiRequest({
      sessionId: `00000000-0000-0000-0000-000000000001`,
      requestId: `00000000-0000-0000-0000-000000000002`,
      url: `http://api.example.com/chat`,
      method: `POST`,
      body: { messages: [] },
    })

    expect(result).toMatchObject({
      sessionId: `00000000-0000-0000-0000-000000000001`,
      requestId: `00000000-0000-0000-0000-000000000002`,
      streamUrl: expect.stringContaining(`/stream`),
    })

    // Wait for background processing to complete
    await new Promise((resolve) => setTimeout(resolve, 100))
  })

  it(`forwards request to backend with correct params`, async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(createSSEStream([])))

    await handleApiRequest({
      sessionId: `00000000-0000-0000-0000-000000000001`,
      requestId: `00000000-0000-0000-0000-000000000002`,
      url: `http://api.example.com/chat`,
      method: `POST`,
      headers: { 'X-Custom': `test` },
      body: { messages: [{ role: `user`, content: `Hello` }] },
    })

    expect(fetch).toHaveBeenCalledWith(
      `http://api.example.com/chat`,
      expect.objectContaining({
        method: `POST`,
        headers: expect.objectContaining({
          'Content-Type': `application/json`,
          'X-Custom': `test`,
        }),
        body: JSON.stringify({
          messages: [{ role: `user`, content: `Hello` }],
        }),
      })
    )

    // Wait for background processing to complete
    await new Promise((resolve) => setTimeout(resolve, 100))
  })

  it(`persists streaming chunks to database`, async () => {
    const chunks = [
      `data: {"type":"start","messageId":"msg-1"}`,
      `data: {"type":"text-delta","id":"msg-1","delta":"Hello"}`,
      `data: {"type":"text-delta","id":"msg-1","delta":" world"}`,
      `data: [DONE]`,
    ]

    vi.mocked(fetch).mockResolvedValue(new Response(createSSEStream(chunks)))

    await handleApiRequest({
      sessionId: `00000000-0000-0000-0000-000000000001`,
      requestId: `00000000-0000-0000-0000-000000000002`,
      url: `http://api.example.com/chat`,
      method: `POST`,
      body: { messages: [] },
    })

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 200))

    const result = await pool.query(
      `SELECT type, data FROM chunks WHERE session = $1 AND request = $2 ORDER BY id`,
      [
        `00000000-0000-0000-0000-000000000001`,
        `00000000-0000-0000-0000-000000000002`,
      ]
    )

    // 4 data chunks + 1 done marker = 5 rows
    expect(result.rows).toHaveLength(5)

    // Data chunks are raw text (still includes JSON, but as string)
    expect(result.rows[0]).toEqual({
      type: `data`,
      data: `{"type":"start","messageId":"msg-1"}`,
    })
    expect(result.rows[1]).toEqual({
      type: `data`,
      data: `{"type":"text-delta","id":"msg-1","delta":"Hello"}`,
    })
    expect(result.rows[2]).toEqual({
      type: `data`,
      data: `{"type":"text-delta","id":"msg-1","delta":" world"}`,
    })
    expect(result.rows[3]).toEqual({ type: `data`, data: `[DONE]` }) // Raw marker preserved

    // Final control message
    expect(result.rows[4]).toEqual({ type: `done`, data: null })
  })

  it(`handles lines without data: prefix`, async () => {
    const chunks = [`{"type":"text-delta","id":"msg-1","delta":"test"}`]

    vi.mocked(fetch).mockResolvedValue(new Response(createSSEStream(chunks)))

    await handleApiRequest({
      sessionId: `00000000-0000-0000-0000-000000000001`,
      requestId: `00000000-0000-0000-0000-000000000002`,
      url: `http://api.example.com/chat`,
      method: `POST`,
      body: { messages: [] },
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    const result = await pool.query(
      `SELECT type, data FROM chunks WHERE session = $1 ORDER BY id`,
      [`00000000-0000-0000-0000-000000000001`]
    )

    // 1 data chunk + 1 done marker = 2 rows
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toEqual({
      type: `data`,
      data: `{"type":"text-delta","id":"msg-1","delta":"test"}`,
    })
    expect(result.rows[1]).toEqual({ type: `done`, data: null })
  })

  it(`returns error response when backend fails`, async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(`Internal Server Error`, { status: 500 })
    )

    const result = await handleApiRequest({
      sessionId: `00000000-0000-0000-0000-000000000001`,
      requestId: `00000000-0000-0000-0000-000000000002`,
      url: `http://api.example.com/chat`,
      method: `POST`,
      body: { messages: [] },
    })

    expect(result).toMatchObject({
      status: `error`,
      response: expect.any(Response),
    })
  })

  it(`writes error control message when stream fails`, async () => {
    const errorStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: {"type":"start"}\n`))
        controller.error(new Error(`Connection reset`))
      },
    })

    vi.mocked(fetch).mockResolvedValue(new Response(errorStream))

    await handleApiRequest({
      sessionId: `00000000-0000-0000-0000-000000000001`,
      requestId: `00000000-0000-0000-0000-000000000002`,
      url: `http://api.example.com/chat`,
      method: `POST`,
      body: { messages: [] },
    })

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 100))

    const result = await pool.query(
      `SELECT type, data FROM chunks WHERE session = $1 ORDER BY id`,
      [`00000000-0000-0000-0000-000000000001`]
    )

    // Should have partial data + error marker
    expect(result.rows.length).toBeGreaterThanOrEqual(1)
    const lastRow = result.rows[result.rows.length - 1]
    expect(lastRow.type).toEqual(`error`)
    expect(lastRow.data).toContain(`Connection reset`)
  })

  it(`writes done marker for empty stream`, async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(createSSEStream([])))

    await handleApiRequest({
      sessionId: `00000000-0000-0000-0000-000000000001`,
      requestId: `00000000-0000-0000-0000-000000000002`,
      url: `http://api.example.com/chat`,
      method: `POST`,
      body: { messages: [] },
    })

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 100))

    const result = await pool.query(
      `SELECT type, data FROM chunks WHERE session = $1 ORDER BY id`,
      [`00000000-0000-0000-0000-000000000001`]
    )

    // Should only have done marker for empty stream
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toEqual({ type: `done`, data: null })
  })
})
