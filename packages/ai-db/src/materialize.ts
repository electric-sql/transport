/**
 * Message materialization from stream rows.
 *
 * Chunk processing is delegated to TanStack AI's StreamProcessor.
 * Our responsibility is grouping chunks by messageId and feeding them to the processor.
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

// ============================================================================
// Message Materialization
// ============================================================================

/**
 * Materialize a single message from its stream rows.
 * Uses TanStack AI's StreamProcessor for chunk semantics.
 *
 * @param rows - Stream rows for a single message
 * @returns Materialized message row
 */
export function materializeMessage(rows: StreamRowWithOffset[]): MessageRow {
  if (rows.length === 0) {
    throw new Error('Cannot materialize message from empty rows')
  }

  // Sort by seq to ensure correct order
  const sorted = [...rows].sort((a, b) => a.seq - b.seq)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]

  // Create a StreamProcessor instance for this message
  const processor = new StreamProcessor()

  // Determine role from first chunk or actor type
  const firstChunk = parseChunk(first.chunk)
  // ContentStreamChunk.role is 'assistant' | undefined, so check actorType for user messages
  const isUserMessage = first.actorType === 'user'

  if (isUserMessage) {
    processor.startUserMessage()
  } else {
    processor.startAssistantMessage()
  }

  // Feed each chunk to the processor
  for (const row of sorted) {
    const chunk = parseChunk(row.chunk)
    if (chunk) {
      processor.processChunk(chunk)
    }
  }

  // Check if message is complete (has 'done' chunk)
  const state = processor.getState()
  const isComplete = state.done || hasFinishChunk(sorted)

  // Finalize if complete
  if (isComplete) {
    processor.finalizeStream()
  }

  // Get the materialized UIMessage
  const messages = processor.getMessages()
  const uiMessage = messages[messages.length - 1]

  // Determine role - only ContentStreamChunk has role property
  let role: MessageRole = 'assistant'
  if (isUserMessage) {
    role = 'user'
  }
  // Note: 'system' role would typically be set differently, not via content chunks

  return {
    id: first.messageId,
    role,
    parts: uiMessage?.parts ?? [],
    actorId: first.actorId,
    actorType: first.actorType,
    isComplete,
    startOffset: first.offset,
    endOffset: isComplete ? last.offset : null,
    createdAt: new Date(first.createdAt),
  }
}

/**
 * Parse a JSON-encoded chunk string.
 *
 * @param chunkJson - JSON string containing StreamChunk
 * @returns Parsed StreamChunk or null if invalid
 */
export function parseChunk(chunkJson: string): StreamChunk | null {
  try {
    return JSON.parse(chunkJson) as StreamChunk
  } catch {
    return null
  }
}

/**
 * Check if rows contain a finish/done chunk.
 *
 * @param rows - Stream rows to check
 * @returns Whether a finish chunk exists
 */
function hasFinishChunk(rows: StreamRowWithOffset[]): boolean {
  for (const row of rows) {
    const chunk = parseChunk(row.chunk)
    if (!chunk) continue

    // Check for done chunk
    if (isDoneChunk(chunk)) {
      return true
    }
  }
  return false
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

    // Handle tool_call chunks
    if (isToolCallChunk(chunk)) {
      const toolCallId = chunk.toolCall.id
      if (!toolCallId) continue

      const existing = toolCallMap.get(toolCallId)

      if (existing) {
        // Update existing tool call - accumulate arguments
        existing.arguments += chunk.toolCall.function.arguments
        if (chunk.toolCall.function.name) {
          existing.name = chunk.toolCall.function.name
        }
      } else {
        // Create new tool call
        toolCallMap.set(toolCallId, {
          id: toolCallId,
          messageId: row.messageId,
          name: chunk.toolCall.function.name ?? '',
          arguments: chunk.toolCall.function.arguments ?? '',
          input: null,
          state: 'pending' as ToolCallState,
          actorId: row.actorId,
          createdAt: new Date(row.createdAt),
        })
      }
    }

    // Check for tool-input-available to mark as executing
    if (chunk.type === 'tool-input-available') {
      const toolInputChunk = chunk as {
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

    if (isToolResultChunk(chunk)) {
      results.push({
        id: `${row.messageId}:${chunk.toolCallId}`,
        toolCallId: chunk.toolCallId,
        messageId: row.messageId,
        output: chunk.content ?? null,
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

    // Handle approval-requested chunks
    if (isApprovalRequestedChunk(chunk)) {
      const approvalId = chunk.approval.id
      if (approvalId) {
        approvalMap.set(approvalId, {
          id: approvalId,
          toolCallId: chunk.toolCallId ?? '',
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

    // Check if message is incomplete
    const isComplete = hasFinishChunk(rows)
    if (isComplete) continue

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
