import { v4 as uuidv4 } from 'uuid'
import { proxyUrl } from '../config'
import { insertChunks } from '../db'
import type { APIRequestData } from '../schema'

type APIResponse = {
  sessionId: string
  requestId: string
  shapeUrl: string
}

type ErrorResponse = {
  status: 'error'
  response: Response
}

const MAX_PENDING_CHUNKS = 50

function parseLine(line: string): string | null {
  line = line.trim()
  if (!line) return null

  if (line.startsWith('data:')) {
    line = line.slice(5).trimStart()
  }

  if (!line || line === '[DONE]') return null

  return line
}

async function persistNewUserMessages(messages: any[]): Promise<void> {
  // XXX store all the *new* messages
  // XXX how do we determine that?!

  // What format can they be in?

  console.log('XXX todo - persistNewUserMessages')
  console.log(messages)

  // const lastMessage = body.messages[body.messages.length - 1]
  // if (lastMessage && lastMessage.role === 'user') {
  //   // Insert a "start" chunk for the user message
  //   await insertChunk(sessionId, messageId, 'user', 'start', {
  //     messageId: messageId,
  //     role: 'user'
  //   })

  //   // Insert user message content
  //   // Handle both parts-based messages (AI SDK 5) and content-based messages
  //   const content = lastMessage.parts?.[0]?.text || lastMessage.content
  //   if (content) {
  //     await insertChunk(sessionId, messageId, 'user', 'text-delta', {
  //       id: 'user-text',
  //       delta: content
  //     })
  //   }

  //   // Mark user message as complete
  //   await insertChunk(sessionId, messageId, 'user', 'finish', {})
  // }
}

async function processApiResponse(data: APIRequestData, body) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  let pendingChunks: string[] = []
  let writeInProgress: Promise<void> | null = null

  // Flush accumulated chunks (non-blocking)
  function tryFlush() {
    if (writeInProgress || pendingChunks.length === 0) return

    const batch = pendingChunks
    pendingChunks = []

    writeInProgress = insertChunks(data.sessionId, data.requestId, batch)
      .finally(() => {
        writeInProgress = null

        tryFlush()
      })
  }

  // Read stream
  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    let idx
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const chunk = parseLine(buffer.slice(0, idx))
      buffer = buffer.slice(idx + 1)

      if (chunk) {
        pendingChunks.push(chunk)

        tryFlush()

        if (writeInProgress && pendingChunks.length >= MAX_PENDING_CHUNKS) {
          // Apply backpressure
          await writeInProgress
        }
      }
    }
  }

  if (buffer.trim()) {
    const chunk = parseLine(buffer)

    if (chunk) pendingChunks.push(chunk)
  }

  if (writeInProgress) await writeInProgress

  if (pendingChunks.length > 0) {
    await insertChunks(data.sessionId, data.requestId, pendingChunks)
  }
}

// Handle API requests by intercepting, returning immediately and then
// continuing to write the response messages to the DB.
export async function handleApiRequest(data: APIRequestData): Promise<APIResponse | ErrorResponse> {
  if (data.body.messages && Array.isArray(data.body.messages)) {
    persistNewUserMessages(data.body.messages)
  }

  const response = await fetch(
    data.url, {
      method: data.method,
      headers: {
        'Content-Type': 'application/json',
          ...data.headers,
      },
      body: JSON.stringify(data.body),
    }
  )

  if (!response.ok) {
    return {
      status: 'error',
      response
    }
  }

  if (response.body) {

    // If this fails silently, we have a problem. We need to write processing
    // errors to the DB and have the client also consume a shape to get them.

    processApiResponse(data, response.body)
      .catch(error => {
        console.error(
          'processApiResponse error', {
            sessionId: data.sessionId,
            requestId: data.requestId
          },
          error
        )
      })
  }

  return {
    sessionId: data.sessionId,
    requestId: data.requestId,
    shapeUrl: `${proxyUrl}/shape`
  }
}