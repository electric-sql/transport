/**
 * Collection exports for @electric-sql/ai-db
 */

// Stream collection
export {
  createStreamCollectionOptions,
  type StreamCollectionOptions,
} from './stream'

// Messages collection
export {
  createMessagesCollectionOptions,
  createUserMessage,
  waitForKey,
} from './messages'

// Tool calls collection
export {
  createToolCallsCollectionOptions,
  getPendingToolCalls,
  canExecuteToolCall,
  type ToolCallsCollectionOptions,
} from './tool-calls'

// Tool results collection
export {
  createToolResultsCollectionOptions,
  getToolResultForCall,
  hasToolResult,
  getFailedToolResults,
  type ToolResultsCollectionOptions,
} from './tool-results'

// Approvals collection
export {
  createApprovalsCollectionOptions,
  getPendingApprovals,
  getApprovalForToolCall,
  requiresApproval,
  isApproved,
  getApprovalsByStatus,
  type ApprovalsCollectionOptions,
} from './approvals'

// Active generations collection
export {
  createActiveGenerationsCollectionOptions,
  hasActiveGeneration,
  getMostRecentActiveGeneration,
  getActiveGenerationsForActor,
  isMessageGenerating,
  type ActiveGenerationsCollectionOptions,
} from './active-generations'

// Session metadata collection
export {
  createSessionMetaCollectionOptions,
  createInitialSessionMeta,
  extractParticipants,
  updateConnectionStatus,
  updateSyncProgress,
  updateParticipants,
  upsertParticipant,
  type SessionMetaCollectionOptions,
} from './session-meta'

// Session statistics collection
export {
  createSessionStatsCollectionOptions,
  computeSessionStats,
  createEmptyStats,
  type SessionStatsCollectionOptions,
} from './session-stats'
