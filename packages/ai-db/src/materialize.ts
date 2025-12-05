/**
 * Message materialization from stream rows.
 *
 * Chunk processing is delegated to TanStack AI's StreamProcessor.
 * Our responsibility is grouping chunks by messageId and feeding them to the processor.
 */

import { StreamProcessor } from '@tanstack/ai'
import type { StreamChunk, UIMessage } from '@tanstack/ai'
import type {
  StreamRow,
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

  // Determine role from first chunk
  const firstChunk = parseChunk(first.chunk)
  const isUserMessage = first.actorType === 'user' || firstChunk?.role === 'user'

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

  // Check if message is complete (has 'done' or 'message-end' chunk)
  const state = processor.getState()
  const isComplete = state.done || hasFinishChunk(sorted)

  // Finalize if complete
  if (isComplete) {
    processor.finalizeStream()
  }

  // Get the materialized UIMessage
  const messages = processor.getMessages()
  const uiMessage = messages[messages.length - 1]

  // Determine role
  let role: MessageRole = 'assistant'
  if (isUserMessage) {
    role = 'user'
  } else if (firstChunk?.role === 'system') {
    role = 'system'
  }

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

    // Check for various finish indicators
    if (
      chunk.type === 'message-end' ||
      chunk.type === 'done' ||
      (chunk.type as string) === 'finish'
    ) {
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

    // Handle tool-call chunks
    if (chunk.type === 'tool-call' || chunk.type === 'tool-call-delta') {
      const toolCallId = (chunk as { toolCallId?: string }).toolCallId
      if (!toolCallId) continue

      const existing = toolCallMap.get(toolCallId)

      if (existing) {
        // Update existing tool call
        if ((chunk as { argumentsDelta?: string }).argumentsDelta) {
          existing.arguments += (chunk as { argumentsDelta: string }).argumentsDelta
        }
        if ((chunk as { name?: string }).name) {
          existing.name = (chunk as { name: string }).name
        }
      } else {
        // Create new tool call
        toolCallMap.set(toolCallId, {
          id: toolCallId,
          messageId: row.messageId,
          name: (chunk as { name?: string }).name ?? '',
          arguments: (chunk as { arguments?: string }).arguments ?? '',
          input: null,
          state: 'pending' as ToolCallState,
          actorId: row.actorId,
          createdAt: new Date(row.createdAt),
        })
      }
    }

    // Handle tool-call-end chunks
    if (chunk.type === 'tool-call-end') {
      const toolCallId = (chunk as { toolCallId?: string }).toolCallId
      if (!toolCallId) continue

      const toolCall = toolCallMap.get(toolCallId)
      if (toolCall) {
        // Try to parse arguments as input
        try {
          toolCall.input = JSON.parse(toolCall.arguments)
        } catch {
          // Keep input as null if parsing fails
        }
        toolCall.state = 'executing'
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

    if (chunk.type === 'tool-result') {
      const toolResultChunk = chunk as {
        toolCallId?: string
        output?: unknown
        error?: string
      }

      if (toolResultChunk.toolCallId) {
        results.push({
          id: `${row.messageId}:${toolResultChunk.toolCallId}`,
          toolCallId: toolResultChunk.toolCallId,
          messageId: row.messageId,
          output: toolResultChunk.output ?? null,
          error: toolResultChunk.error ?? null,
          actorId: row.actorId,
          createdAt: new Date(row.createdAt),
        })
      }
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

    // Handle approval-request chunks
    if (chunk.type === 'approval-request') {
      const approvalChunk = chunk as {
        approvalId?: string
        toolCallId?: string
      }

      if (approvalChunk.approvalId) {
        approvalMap.set(approvalChunk.approvalId, {
          id: approvalChunk.approvalId,
          toolCallId: approvalChunk.toolCallId ?? '',
          messageId: row.messageId,
          status: 'pending' as ApprovalStatus,
          requestedBy: row.actorId,
          requestedAt: new Date(row.createdAt),
          respondedBy: null,
          respondedAt: null,
        })
      }
    }

    // Handle approval-response chunks
    if (chunk.type === 'approval-response') {
      const responseChunk = chunk as {
        approvalId?: string
        approved?: boolean
      }

      if (responseChunk.approvalId) {
        const approval = approvalMap.get(responseChunk.approvalId)
        if (approval) {
          approval.status = responseChunk.approved ? 'approved' : 'denied'
          approval.respondedBy = row.actorId
          approval.respondedAt = new Date(row.createdAt)
        }
      }
    }
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
 * Extract text content from a UIMessage.
 *
 * @param message - Message to extract from
 * @returns Combined text content
 */
export function extractTextContent(message: { parts: Array<{ type: string; text?: string }> }): string {
  return message.parts
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => p.text!)
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
