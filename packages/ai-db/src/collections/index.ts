/**
 * Collection exports for @electric-sql/ai-db
 *
 * All collections follow the two-stage pipeline pattern:
 * 1. Aggregate stage: groupBy + collect to gather rows
 * 2. Materialize stage: fn.select to transform into final types
 *
 * Collections contain fully materialized objects - no helper functions needed.
 */

// Stream collection (root - synced from Durable Stream)
export {
  createStreamCollectionOptions,
  type StreamCollectionOptions,
} from './stream'

// Messages collection (two-stage pipeline)
export {
  createCollectedMessagesCollection,
  createMessagesCollection,
  createMessagesPipeline,
  waitForKey,
  type CollectedMessageRows,
  type CollectedMessagesCollectionOptions,
  type MessagesCollectionOptions,
  type MessagesPipelineOptions,
  type MessagesPipelineResult,
} from './messages'

// Tool calls collection (derived from collectedMessages)
export {
  createToolCallsCollection,
  type ToolCallsCollectionOptions,
} from './tool-calls'

// Tool results collection (derived from collectedMessages)
export {
  createToolResultsCollection,
  type ToolResultsCollectionOptions,
} from './tool-results'

// Approvals collection (derived from collectedMessages)
export {
  createApprovalsCollection,
  type ApprovalsCollectionOptions,
} from './approvals'

// Active generations collection (derived from messages)
export {
  createActiveGenerationsCollection,
  type ActiveGenerationsCollectionOptions,
} from './active-generations'

// Session metadata collection (local state - not derived)
export {
  createSessionMetaCollectionOptions,
  createInitialSessionMeta,
  updateConnectionStatus,
  updateSyncProgress,
  type SessionMetaCollectionOptions,
} from './session-meta'

// Session participants collection (two-stage pipeline)
export {
  createSessionParticipantsCollection,
  type SessionParticipantsCollectionOptions,
} from './session-participants'

// Session statistics collection (two-stage pipeline)
export {
  createSessionStatsCollection,
  computeSessionStats,
  createEmptyStats,
  type SessionStatsCollectionOptions,
} from './session-stats'
