/**
 * Message materialization from stream rows.
 *
 * Handles two formats:
 * 1. User messages: Single row with {type: 'user-message', message: UIMessage}
 * 2. Assistant messages: Multiple rows with TanStack AI StreamChunks
 *
 * Chunk processing for assistant messages is delegated to TanStack AI's StreamProcessor.
 */

import { StreamProcessor } from '@tanstack/ai'
import type {
  StreamChunk,
  ContentStreamChunk,
  ToolCallStreamChunk,
  ToolResultStreamChunk,
  DoneStreamChunk,
  ApprovalRequestedStreamChunk,
} from '@tanstack/ai'
import type {
  StreamRowWithOffset,
  MessageRow,
  MessageRole,
  ToolCallRow,
  ToolCallState,
  ToolResultRow,
  ApprovalRow,
  ApprovalStatus,
  ActiveGenerationRow,
  UserMessageChunk,
  DurableStreamChunk,
} from './types'

// ============================================================================
// Type Guards for StreamChunk
// ============================================================================

function isContentChunk(chunk: StreamChunk): chunk is ContentStreamChunk {
  return chunk.type === 'content'
}

function isToolCallChunk(chunk: StreamChunk): chunk is ToolCallStreamChunk {
  return chunk.type === 'tool_call'
}

function isToolResultChunk(chunk: StreamChunk): chunk is ToolResultStreamChunk {
  return chunk.type === 'tool_result'
}

function isDoneChunk(chunk: StreamChunk): chunk is DoneStreamChunk {
  return chunk.type === 'done'
}

function isApprovalRequestedChunk(chunk: StreamChunk): chunk is ApprovalRequestedStreamChunk {
  return chunk.type === 'approval-requested'
}

/**
 * Type guard for UserMessageChunk.
 */
function isUserMessageChunk(chunk: DurableStreamChunk | null): chunk is UserMessageChunk {
  return chunk !== null && chunk.type === 'user-message'
}

// ============================================================================
// Message Materialization
// ============================================================================

/**
 * Parse a JSON-encoded chunk string.
 *
 * @param chunkJson - JSON string containing DurableStreamChunk
 * @returns Parsed chunk or null if invalid
 */
export function parseChunk(chunkJson: string): DurableStreamChunk | null {
  try {
    return JSON.parse(chunkJson) as DurableStreamChunk
  } catch {
    return null
  }
}

/**
 * Materialize a user message from a single row.
 * User messages are stored as complete UIMessage objects.
 */
function materializeUserMessage(
  row: StreamRowWithOffset,
  chunk: UserMessageChunk
): MessageRow {
  const { message } = chunk

  return {
    id: message.id,
    role: message.role as MessageRole,
    parts: message.parts,
    actorId: row.actorId,
    actorType: row.actorType,
    isComplete: true,
    startOffset: row.offset,
    endOffset: row.offset,
    createdAt: message.createdAt ? new Date(message.createdAt) : new Date(row.createdAt),
  }
}

/**
 * Materialize an assistant message from streamed chunks.
 * Uses TanStack AI's StreamProcessor to process chunks.
 */
function materializeAssistantMessage(rows: StreamRowWithOffset[]): MessageRow {
  const sorted = [...rows].sort((a, b) => a.seq - b.seq)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]

  // Create processor and start assistant message
  const processor = new StreamProcessor()
  processor.startAssistantMessage()

  let isComplete = false

  for (const row of sorted) {
    const chunk = parseChunk(row.chunk)
    if (!chunk) continue

    // Skip legacy wrapper chunks (for backward compatibility)
    if ((chunk as any).type === 'message-start' || (chunk as any).type === 'message-end') {
      if ((chunk as any).type === 'message-end') {
        isComplete = true
      }
      continue
    }

    // Skip user-message chunks (shouldn't be in assistant messages, but guard)
    if (isUserMessageChunk(chunk)) continue

    // Process TanStack AI StreamChunk
    try {
      processor.processChunk(chunk as StreamChunk)
    } catch {
      // Skip chunks that can't be processed
    }

    if (isDoneChunk(chunk as StreamChunk)) {
      isComplete = true
    }
  }

  // Finalize if complete
  if (isComplete) {
    processor.finalizeStream()
  }

  // Get the materialized UIMessage
  const messages = processor.getMessages()
  const message = messages[messages.length - 1]

  return {
    id: first.messageId,
    role: 'assistant',
    parts: message?.parts ?? [],
    actorId: first.actorId,
    actorType: first.actorType,
    isComplete,
    startOffset: first.offset,
    endOffset: isComplete ? last.offset : null,
    createdAt: new Date(first.createdAt),
  }
}

/**
 * Materialize a MessageRow from collected stream rows.
 *
 * Handles two formats:
 * 1. User messages: Single row with {type: 'user-message', message: UIMessage}
 * 2. Assistant messages: Multiple rows with TanStack AI StreamChunks
 *
 * @param rows - Stream rows for a single message
 * @returns Materialized message row
 */
export function materializeMessage(rows: StreamRowWithOffset[]): MessageRow {
  if (!rows || rows.length === 0) {
    throw new Error('Cannot materialize message from empty rows')
  }

  // Sort by seq to ensure correct order
  const sorted = [...rows].sort((a, b) => a.seq - b.seq)
  const firstChunk = parseChunk(sorted[0].chunk)

  if (!firstChunk) {
    throw new Error('Failed to parse first chunk')
  }

  // Check if this is a complete user message
  if (isUserMessageChunk(firstChunk)) {
    return materializeUserMessage(sorted[0], firstChunk)
  }

  // Otherwise, process as streamed assistant message
  return materializeAssistantMessage(sorted)
}

// ============================================================================
// Tool Call Extraction
// ============================================================================

/**
 * Extract tool calls from stream rows.
 *
 * @param rows - Stream rows to extract from
 * @returns Array of tool call rows
 */
export function extractToolCalls(rows: StreamRowWithOffset[]): ToolCallRow[] {
  const toolCallMap = new Map<string, ToolCallRow>()

  for (const row of rows) {
    const chunk = parseChunk(row.chunk)
    if (!chunk) continue

    // Skip user-message chunks (not relevant for tool calls)
    if (isUserMessageChunk(chunk)) continue

    // Handle tool_call chunks
    const streamChunk = chunk as StreamChunk
    if (isToolCallChunk(streamChunk)) {
      const toolCallId = streamChunk.toolCall.id
      if (!toolCallId) continue

      const existing = toolCallMap.get(toolCallId)

      if (existing) {
        // Update existing tool call - accumulate arguments
        existing.arguments += streamChunk.toolCall.function.arguments
        if (streamChunk.toolCall.function.name) {
          existing.name = streamChunk.toolCall.function.name
        }
      } else {
        // Create new tool call
        toolCallMap.set(toolCallId, {
          id: toolCallId,
          messageId: row.messageId,
          name: streamChunk.toolCall.function.name ?? '',
          arguments: streamChunk.toolCall.function.arguments ?? '',
          input: null,
          state: 'pending' as ToolCallState,
          actorId: row.actorId,
          createdAt: new Date(row.createdAt),
        })
      }
    }

    // Check for tool-input-available to mark as executing
    if (streamChunk.type === 'tool-input-available') {
      const toolInputChunk = streamChunk as {
        toolCallId?: string
        input?: unknown
      }
      if (toolInputChunk.toolCallId) {
        const toolCall = toolCallMap.get(toolInputChunk.toolCallId)
        if (toolCall) {
          toolCall.input = toolInputChunk.input ?? null
          toolCall.state = 'executing'
        }
      }
    }
  }

  // Try to parse arguments as input for any tool calls that don't have input yet
  for (const toolCall of toolCallMap.values()) {
    if (toolCall.input === null && toolCall.arguments) {
      try {
        toolCall.input = JSON.parse(toolCall.arguments)
      } catch {
        // Keep input as null if parsing fails
      }
    }
  }

  return Array.from(toolCallMap.values())
}

// ============================================================================
// Tool Result Extraction
// ============================================================================

/**
 * Extract tool results from stream rows.
 *
 * @param rows - Stream rows to extract from
 * @returns Array of tool result rows
 */
export function extractToolResults(rows: StreamRowWithOffset[]): ToolResultRow[] {
  const results: ToolResultRow[] = []

  for (const row of rows) {
    const chunk = parseChunk(row.chunk)
    if (!chunk) continue

    // Skip user-message chunks
    if (isUserMessageChunk(chunk)) continue

    const streamChunk = chunk as StreamChunk
    if (isToolResultChunk(streamChunk)) {
      results.push({
        id: `${row.messageId}:${streamChunk.toolCallId}`,
        toolCallId: streamChunk.toolCallId,
        messageId: row.messageId,
        output: streamChunk.content ?? null,
        error: null,
        actorId: row.actorId,
        createdAt: new Date(row.createdAt),
      })
    }
  }

  return results
}

// ============================================================================
// Approval Extraction
// ============================================================================

/**
 * Extract approvals from stream rows.
 *
 * @param rows - Stream rows to extract from
 * @returns Array of approval rows
 */
export function extractApprovals(rows: StreamRowWithOffset[]): ApprovalRow[] {
  const approvalMap = new Map<string, ApprovalRow>()

  for (const row of rows) {
    const chunk = parseChunk(row.chunk)
    if (!chunk) continue

    // Skip user-message chunks
    if (isUserMessageChunk(chunk)) continue

    const streamChunk = chunk as StreamChunk

    // Handle approval-requested chunks
    if (isApprovalRequestedChunk(streamChunk)) {
      const approvalId = streamChunk.approval.id
      if (approvalId) {
        approvalMap.set(approvalId, {
          id: approvalId,
          toolCallId: streamChunk.toolCallId ?? '',
          messageId: row.messageId,
          status: 'pending' as ApprovalStatus,
          requestedBy: row.actorId,
          requestedAt: new Date(row.createdAt),
          respondedBy: null,
          respondedAt: null,
        })
      }
    }

    // Note: approval responses would typically come through a separate mechanism
    // (e.g., a POST to the proxy endpoint), not as stream chunks
  }

  return Array.from(approvalMap.values())
}

// ============================================================================
// Active Generation Detection
// ============================================================================

/**
 * Check if message rows indicate a complete message.
 * User messages are always complete. Assistant messages are complete if they have a 'done' chunk.
 */
function isMessageComplete(rows: StreamRowWithOffset[]): boolean {
  if (rows.length === 0) return false

  const sorted = [...rows].sort((a, b) => a.seq - b.seq)
  const firstChunk = parseChunk(sorted[0].chunk)

  // User messages are always complete
  if (firstChunk && isUserMessageChunk(firstChunk)) {
    return true
  }

  // For assistant messages, check for done or message-end chunk
  for (const row of rows) {
    const chunk = parseChunk(row.chunk)
    if (!chunk) continue

    if (isUserMessageChunk(chunk)) continue

    const streamChunk = chunk as StreamChunk
    if (isDoneChunk(streamChunk)) {
      return true
    }
    // Also check legacy message-end for backward compatibility
    if ((chunk as any).type === 'message-end') {
      return true
    }
  }

  return false
}

/**
 * Detect active generations (incomplete messages) from rows.
 *
 * @param rowsByMessage - Map of messageId to rows
 * @returns Array of active generation rows
 */
export function detectActiveGenerations(
  rowsByMessage: Map<string, StreamRowWithOffset[]>
): ActiveGenerationRow[] {
  const activeGenerations: ActiveGenerationRow[] = []

  for (const [messageId, rows] of rowsByMessage) {
    if (rows.length === 0) continue

    // Check if message is complete
    if (isMessageComplete(rows)) continue

    // Sort by seq to find first and last
    const sorted = [...rows].sort((a, b) => a.seq - b.seq)
    const first = sorted[0]
    const last = sorted[sorted.length - 1]

    activeGenerations.push({
      messageId,
      actorId: first.actorId,
      startedAt: new Date(first.createdAt),
      lastChunkOffset: last.offset,
      lastChunkAt: new Date(last.createdAt),
    })
  }

  return activeGenerations
}

// ============================================================================
// Message Grouping
// ============================================================================

/**
 * Group stream rows by messageId.
 *
 * @param rows - Stream rows to group
 * @returns Map of messageId to rows
 */
export function groupRowsByMessage(
  rows: StreamRowWithOffset[]
): Map<string, StreamRowWithOffset[]> {
  const grouped = new Map<string, StreamRowWithOffset[]>()

  for (const row of rows) {
    const existing = grouped.get(row.messageId)
    if (existing) {
      existing.push(row)
    } else {
      grouped.set(row.messageId, [row])
    }
  }

  return grouped
}

/**
 * Materialize all messages from stream rows.
 *
 * @param rows - All stream rows
 * @returns Array of materialized message rows, sorted by startOffset
 */
export function materializeAllMessages(rows: StreamRowWithOffset[]): MessageRow[] {
  const grouped = groupRowsByMessage(rows)
  const messages: MessageRow[] = []

  for (const [, messageRows] of grouped) {
    messages.push(materializeMessage(messageRows))
  }

  // Sort by startOffset for chronological order
  messages.sort((a, b) => a.startOffset.localeCompare(b.startOffset))

  return messages
}

// ============================================================================
// Content Extraction Helpers
// ============================================================================

/**
 * Extract text content from a UIMessage or MessageRow.
 *
 * @param message - Message to extract from
 * @returns Combined text content
 */
export function extractTextContent(message: { parts: Array<{ type: string; text?: string; content?: string }> }): string {
  return message.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? p.content ?? '')
    .join('')
}

/**
 * Check if a message row is from a user.
 *
 * @param row - Message row to check
 * @returns Whether the message is from a user
 */
export function isUserMessage(row: MessageRow): boolean {
  return row.role === 'user' || row.actorType === 'user'
}

/**
 * Check if a message row is from an assistant/agent.
 *
 * @param row - Message row to check
 * @returns Whether the message is from an assistant
 */
export function isAssistantMessage(row: MessageRow): boolean {
  return row.role === 'assistant' || row.actorType === 'agent'
}
