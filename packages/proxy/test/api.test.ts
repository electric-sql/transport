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
    }
  })
}

describe('handleApiRequest', () => {
  beforeEach(async () => {
    await applyMigrations()
    await pool.query('TRUNCATE chunks')

    vi.stubGlobal('fetch', vi.fn())
  })

  it('returns shape metadata immediately', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(createSSEStream([]))
    )

    const result = await handleApiRequest({
      sessionId: '00000000-0000-0000-0000-000000000001',
      requestId: '00000000-0000-0000-0000-000000000002',
      url: 'http://api.example.com/chat',
      method: 'POST',
      body: { messages: [] }
    })

    expect(result).toMatchObject({
      sessionId: '00000000-0000-0000-0000-000000000001',
      requestId: '00000000-0000-0000-0000-000000000002',
      shapeUrl: expect.stringContaining('/shape'),
      offset: '-1'
    })
  })

  it('forwards request to backend with correct params', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(createSSEStream([]))
    )

    await handleApiRequest({
      sessionId: '00000000-0000-0000-0000-000000000001',
      requestId: '00000000-0000-0000-0000-000000000002',
      url: 'http://api.example.com/chat',
      method: 'POST',
      headers: { 'X-Custom': 'test' },
      body: { messages: [{ role: 'user', content: 'Hello' }] }
    })

    expect(fetch).toHaveBeenCalledWith(
      'http://api.example.com/chat',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Custom': 'test'
        }),
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] })
      })
    )
  })

  it('persists streaming chunks to database', async () => {
    const chunks = [
      'data: {"type":"start","messageId":"msg-1"}',
      'data: {"type":"text-delta","id":"msg-1","delta":"Hello"}',
      'data: {"type":"text-delta","id":"msg-1","delta":" world"}',
      'data: [DONE]'
    ]

    vi.mocked(fetch).mockResolvedValue(
      new Response(createSSEStream(chunks))
    )

    await handleApiRequest({
      sessionId: '00000000-0000-0000-0000-000000000001',
      requestId: '00000000-0000-0000-0000-000000000002',
      url: 'http://api.example.com/chat',
      method: 'POST',
      body: { messages: [] }
    })

    // Wait for async processing
    await new Promise(resolve => setTimeout(resolve, 100))

    const result = await pool.query(
      'SELECT data FROM chunks WHERE session = $1 AND request = $2 ORDER BY id',
      ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002']
    )

    expect(result.rows).toHaveLength(3)
    expect(result.rows[0].data).toEqual({ type: 'start', messageId: 'msg-1' })
    expect(result.rows[1].data).toEqual({ type: 'text-delta', id: 'msg-1', delta: 'Hello' })
    expect(result.rows[2].data).toEqual({ type: 'text-delta', id: 'msg-1', delta: ' world' })
  })

  it('handles lines without data: prefix', async () => {
    const chunks = [
      '{"type":"text-delta","id":"msg-1","delta":"test"}'
    ]

    vi.mocked(fetch).mockResolvedValue(
      new Response(createSSEStream(chunks))
    )

    await handleApiRequest({
      sessionId: '00000000-0000-0000-0000-000000000001',
      requestId: '00000000-0000-0000-0000-000000000002',
      url: 'http://api.example.com/chat',
      method: 'POST',
      body: { messages: [] }
    })

    await new Promise(resolve => setTimeout(resolve, 100))

    const result = await pool.query(
      'SELECT data FROM chunks WHERE session = $1',
      ['00000000-0000-0000-0000-000000000001']
    )

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].data).toEqual({ type: 'text-delta', id: 'msg-1', delta: 'test' })
  })

  it('returns error response when backend fails', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('Internal Server Error', { status: 500 })
    )

    const result = await handleApiRequest({
      sessionId: '00000000-0000-0000-0000-000000000001',
      requestId: '00000000-0000-0000-0000-000000000002',
      url: 'http://api.example.com/chat',
      method: 'POST',
      body: { messages: [] }
    })

    expect(result).toMatchObject({
      status: 'error',
      response: expect.any(Response)
    })
  })
})
