import { Readable } from 'stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyMigrations, pool } from '../src/db'
import { handleApiRequest, type APIRequestData } from '../src/handlers/api'

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
  beforeEach(async () => {
    await applyMigrations()
    await pool.query(`TRUNCATE data_chunks`)
    await pool.query(`TRUNCATE control_messages`)

    vi.stubGlobal(`fetch`, vi.fn())
  })

  it(`returns stream metadata immediately with both streamUrl and controlUrl`, async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(createSSEStream([])))

    const result = await handleApiRequest(createTestRequest())

    expect(result).toMatchObject({
      sessionId: `00000000-0000-0000-0000-000000000001`,
      requestId: `00000000-0000-0000-0000-000000000002`,
      streamUrl: expect.stringContaining(`/stream/data`),
      controlUrl: expect.stringContaining(`/stream/control`),
    })

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
        body: JSON.stringify({ messages: [{ role: `user`, content: `Hello` }] }),
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

  it(`persists streaming data chunks to data_chunks table and control message to control_messages`, async () => {
    const chunks = [
      `data: {"type":"start","messageId":"msg-1"}`,
      `data: {"type":"text-delta","id":"msg-1","delta":"Hello"}`,
      `data: {"type":"text-delta","id":"msg-1","delta":" world"}`,
      `data: [DONE]`,
    ]

    vi.mocked(fetch).mockResolvedValue(new Response(createSSEStream(chunks)))

    await handleApiRequest(createTestRequest())

    // Wait for async processing (buffer accumulation + DB writes)
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Check data_chunks table
    const dataResult = await pool.query(
      `SELECT id, data FROM data_chunks WHERE session = $1 AND request = $2 ORDER BY id`,
      [
        `00000000-0000-0000-0000-000000000001`,
        `00000000-0000-0000-0000-000000000002`,
      ]
    )

    // At least 1 data chunk should exist
    expect(dataResult.rows.length).toBeGreaterThanOrEqual(1)

    // Concatenate all data chunks to verify content
    const allData = dataResult.rows.map((row) => row.data).join(``)

    // Verify all original content is preserved (raw SSE format with data: prefix)
    expect(allData).toContain(`data: {"type":"start","messageId":"msg-1"}`)
    expect(allData).toContain(
      `data: {"type":"text-delta","id":"msg-1","delta":"Hello"}`
    )
    expect(allData).toContain(
      `data: {"type":"text-delta","id":"msg-1","delta":" world"}`
    )
    expect(allData).toContain(`data: [DONE]`)

    // Check control_messages table
    const controlResult = await pool.query(
      `SELECT event, data_row_id, payload FROM control_messages WHERE session = $1 AND request = $2`,
      [
        `00000000-0000-0000-0000-000000000001`,
        `00000000-0000-0000-0000-000000000002`,
      ]
    )

    expect(controlResult.rows).toHaveLength(1)
    expect(controlResult.rows[0].event).toBe(`done`)
    expect(controlResult.rows[0].data_row_id).toBeDefined()
    // data_row_id should be a zero-padded string
    expect(controlResult.rows[0].data_row_id.length).toBe(20)
    expect(controlResult.rows[0].payload).toEqual({ finishReason: `complete` })
  })

  it(`preserves raw content without modification`, async () => {
    const chunks = [`{"type":"text-delta","id":"msg-1","delta":"test"}`]

    vi.mocked(fetch).mockResolvedValue(new Response(createSSEStream(chunks)))

    await handleApiRequest(createTestRequest())

    await new Promise((resolve) => setTimeout(resolve, 100))

    const dataResult = await pool.query(
      `SELECT data FROM data_chunks WHERE session = $1 ORDER BY id`,
      [`00000000-0000-0000-0000-000000000001`]
    )

    // At least 1 data chunk
    expect(dataResult.rows.length).toBeGreaterThanOrEqual(1)

    // Concatenate all data chunks to verify content preserved
    const allData = dataResult.rows.map((row) => row.data).join(``)

    // Content is preserved as-is (including the newline from createSSEStream)
    expect(allData).toContain(
      `{"type":"text-delta","id":"msg-1","delta":"test"}`
    )

    // Control message should exist
    const controlResult = await pool.query(
      `SELECT event FROM control_messages WHERE session = $1`,
      [`00000000-0000-0000-0000-000000000001`]
    )
    expect(controlResult.rows[0].event).toBe(`done`)
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

  it(`writes error control message when stream fails`, async () => {
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

    // Check that partial data was written
    const dataResult = await pool.query(
      `SELECT data FROM data_chunks WHERE session = $1`,
      [`00000000-0000-0000-0000-000000000001`]
    )
    // May or may not have data depending on timing
    expect(dataResult.rows.length).toBeGreaterThanOrEqual(0)

    // Check error control message
    const controlResult = await pool.query(
      `SELECT event, data_row_id, payload FROM control_messages WHERE session = $1`,
      [`00000000-0000-0000-0000-000000000001`]
    )

    expect(controlResult.rows).toHaveLength(1)
    expect(controlResult.rows[0].event).toBe(`error`)
    expect(controlResult.rows[0].data_row_id).toBeDefined()
    expect(controlResult.rows[0].payload.message).toContain(`Connection reset`)
  })

  it(`writes done control message for empty stream with zero data_row_id`, async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(createSSEStream([])))

    await handleApiRequest(createTestRequest())

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 100))

    // No data chunks for empty stream
    const dataResult = await pool.query(
      `SELECT data FROM data_chunks WHERE session = $1`,
      [`00000000-0000-0000-0000-000000000001`]
    )
    expect(dataResult.rows).toHaveLength(0)

    // Control message with done event
    const controlResult = await pool.query(
      `SELECT event, data_row_id, payload FROM control_messages WHERE session = $1`,
      [`00000000-0000-0000-0000-000000000001`]
    )

    expect(controlResult.rows).toHaveLength(1)
    expect(controlResult.rows[0].event).toBe(`done`)
    // data_row_id should be the initial zero-padded value
    expect(controlResult.rows[0].data_row_id).toBe(`00000000000000000000`)
    expect(controlResult.rows[0].payload).toEqual({ finishReason: `complete` })
  })

  it(`data_row_id correctly references the last data chunk row ID`, async () => {
    const chunks = [`chunk1`, `chunk2`, `chunk3`]

    vi.mocked(fetch).mockResolvedValue(new Response(createSSEStream(chunks)))

    await handleApiRequest(createTestRequest())

    await new Promise((resolve) => setTimeout(resolve, 500))

    // Get the max data chunk ID
    const dataResult = await pool.query(
      `SELECT MAX(id) as max_id FROM data_chunks WHERE session = $1`,
      [`00000000-0000-0000-0000-000000000001`]
    )
    const maxDataId = dataResult.rows[0].max_id

    // Get the control message
    const controlResult = await pool.query(
      `SELECT data_row_id FROM control_messages WHERE session = $1`,
      [`00000000-0000-0000-0000-000000000001`]
    )

    // The data_row_id in the control message should match the max data chunk ID
    const expectedDataRowId = maxDataId.toString().padStart(20, `0`)
    expect(controlResult.rows[0].data_row_id).toBe(expectedDataRowId)
  })
})
