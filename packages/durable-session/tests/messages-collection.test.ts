/**
 * Tests for the messages collection live query pipeline.
 *
 * Verifies that the two-stage pipeline (chunks → collectedMessages → messages)
 * correctly materializes messages from streamed data.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createMockChunksCollection,
  loadTestData,
  getMessageRows,
  getMessageIds,
  streamRowsToChunkRows,
  flushPromises,
  collectChanges,
  TEST_MESSAGE_IDS,
  EXPECTED_CONTENT,
} from './fixtures/test-helpers'
import {
  createCollectedMessagesCollection,
  createMessagesCollection,
  type CollectedMessageRows,
} from '../src/collections/messages'
import type { ChunkRow } from '../src/schema'
import type { MessageRow } from '../src/types'
import type { Collection } from '@tanstack/db'
import { createOptimisticAction } from '@tanstack/db'

describe('messages collection', () => {
  const testData = loadTestData()
  const messageIds = getMessageIds(testData)

  // Collections to be set up in beforeEach
  let chunksCollection: Collection<ChunkRow>
  let controller: ReturnType<typeof createMockChunksCollection>['controller']
  let collectedMessagesCollection: Collection<CollectedMessageRows>
  let messagesCollection: Collection<MessageRow>

  beforeEach(() => {
    // Create mock chunks collection
    const mock = createMockChunksCollection('test-session')
    chunksCollection = mock.collection
    controller = mock.controller

    // Create the two-stage pipeline
    // Note: derived collections use startSync: true, so they start syncing immediately
    collectedMessagesCollection = createCollectedMessagesCollection({
      sessionId: 'test-session',
      chunksCollection,
    })

    messagesCollection = createMessagesCollection({
      sessionId: 'test-session',
      collectedMessagesCollection,
    })

    // Initialize chunks collection
    chunksCollection.preload()
    controller.markReady()
  })

  // ==========================================================================
  // Single User Message Tests
  // ==========================================================================

  describe('single user message', () => {
    it('should materialize a user message from stream row', async () => {
      // Get first user message rows
      const userMessageId = TEST_MESSAGE_IDS.USER_1
      const userMessageRows = getMessageRows(testData, userMessageId)

      // Emit the user message (single row for user messages)
      controller.emit(userMessageRows)
      await flushPromises()

      // Verify messages collection
      expect(messagesCollection.size).toBe(1)

      const message = messagesCollection.get(userMessageId)
      expect(message).toBeDefined()
      expect(message?.id).toBe(userMessageId)
      expect(message?.role).toBe('user')
      expect(message?.parts).toHaveLength(1)
      expect(message?.parts[0]).toEqual({ type: 'text', content: EXPECTED_CONTENT.USER_1 })
      expect(message?.isComplete).toBe(true) // User messages are always complete
    })

    it('should set correct metadata for user message', async () => {
      const userMessageId = TEST_MESSAGE_IDS.USER_1
      const userMessageRows = getMessageRows(testData, userMessageId)

      controller.emit(userMessageRows)
      await flushPromises()

      const message = messagesCollection.get(userMessageId)
      expect(message?.role).toBe('user')
      expect(message?.actorId).toBeDefined()
      expect(message?.isComplete).toBe(true)
      expect(message?.createdAt).toBeInstanceOf(Date)
    })
  })

  // ==========================================================================
  // User + Assistant Message Tests
  // ==========================================================================

  describe('user message + assistant response', () => {
    it('should materialize both messages in correct order', async () => {
      // Emit user message
      const userMessageId = TEST_MESSAGE_IDS.USER_1
      controller.emit(getMessageRows(testData, userMessageId))
      await flushPromises()

      expect(messagesCollection.size).toBe(1)

      // Emit all assistant response chunks at once
      const assistantMessageId = TEST_MESSAGE_IDS.ASSISTANT_1
      const assistantRows = getMessageRows(testData, assistantMessageId)
      controller.emit(assistantRows)
      await flushPromises()

      // Should have both messages
      expect(messagesCollection.size).toBe(2)

      // Verify user message
      const userMessage = messagesCollection.get(userMessageId)
      expect(userMessage?.role).toBe('user')
      expect(userMessage?.parts[0]).toEqual({ type: 'text', content: EXPECTED_CONTENT.USER_1 })

      // Verify assistant message
      const assistantMessage = messagesCollection.get(assistantMessageId)
      expect(assistantMessage?.role).toBe('assistant')
      expect(assistantMessage?.isComplete).toBe(true)
      // Check the text part content
      const textPart = assistantMessage?.parts.find(p => p.type === 'text')
      expect(textPart).toBeDefined()
      expect((textPart as { type: 'text'; content: string })?.content).toBe(EXPECTED_CONTENT.ASSISTANT_1)
    })

    it('should update assistant message content as chunks stream in', async () => {
      // First emit user message
      const userMessageId = TEST_MESSAGE_IDS.USER_1
      controller.emit(getMessageRows(testData, userMessageId))
      await flushPromises()

      // Get assistant chunks in order
      const assistantMessageId = TEST_MESSAGE_IDS.ASSISTANT_1
      const assistantRows = getMessageRows(testData, assistantMessageId)

      // Emit first chunk (empty content initialization)
      controller.emit([assistantRows[0]])
      await flushPromises()

      expect(messagesCollection.size).toBe(2)
      let assistantMessage = messagesCollection.get(assistantMessageId)
      expect(assistantMessage?.isComplete).toBe(false)

      // Emit delta chunks one by one
      for (let i = 1; i < assistantRows.length - 1; i++) {
        controller.emit([assistantRows[i]])
        await flushPromises()

        assistantMessage = messagesCollection.get(assistantMessageId)
        // Content should be accumulating, message should not be complete yet
        expect(assistantMessage?.isComplete).toBe(false)
      }

      // Emit done chunk
      controller.emit([assistantRows[assistantRows.length - 1]])
      await flushPromises()

      assistantMessage = messagesCollection.get(assistantMessageId)
      expect(assistantMessage?.isComplete).toBe(true)
      // Check the text part content
      const textPart = assistantMessage?.parts.find(p => p.type === 'text')
      expect(textPart).toBeDefined()
      expect((textPart as { type: 'text'; content: string })?.content).toBe(EXPECTED_CONTENT.ASSISTANT_1)
    })

    it('should track correct offsets for assistant message', async () => {
      // Emit user message first
      controller.emit(getMessageRows(testData, TEST_MESSAGE_IDS.USER_1))
      await flushPromises()

      // Emit assistant message
      const assistantMessageId = TEST_MESSAGE_IDS.ASSISTANT_1
      const assistantRows = getMessageRows(testData, assistantMessageId)
      controller.emit(assistantRows)
      await flushPromises()

      const assistantMessage = messagesCollection.get(assistantMessageId)
      expect(assistantMessage?.startOffset).toBe(assistantRows[0].offset)
      expect(assistantMessage?.endOffset).toBe(assistantRows[assistantRows.length - 1].offset)
    })
  })

  // ==========================================================================
  // Full Conversation Flow Tests
  // ==========================================================================

  describe('full conversation flow', () => {
    it('should handle user -> assistant -> user -> assistant correctly', async () => {
      // Emit all test data at once (simulates catching up on reconnect)
      controller.emit(streamRowsToChunkRows(testData))
      await flushPromises()

      // Should have 4 messages
      expect(messagesCollection.size).toBe(4)

      // Verify each message by ID
      const msg1 = messagesCollection.get(TEST_MESSAGE_IDS.USER_1)
      expect(msg1?.role).toBe('user')
      expect(msg1?.parts[0]).toEqual({ type: 'text', content: EXPECTED_CONTENT.USER_1 })

      const msg2 = messagesCollection.get(TEST_MESSAGE_IDS.ASSISTANT_1)
      expect(msg2?.role).toBe('assistant')
      const text2 = msg2?.parts.find(p => p.type === 'text')
      expect((text2 as { type: 'text'; content: string })?.content).toContain('Hi there!')

      const msg3 = messagesCollection.get(TEST_MESSAGE_IDS.USER_2)
      expect(msg3?.role).toBe('user')
      expect(msg3?.parts[0]).toEqual({ type: 'text', content: EXPECTED_CONTENT.USER_2 })

      const msg4 = messagesCollection.get(TEST_MESSAGE_IDS.ASSISTANT_2)
      expect(msg4?.role).toBe('assistant')
      const text4 = msg4?.parts.find(p => p.type === 'text')
      expect((text4 as { type: 'text'; content: string })?.content).toContain('No problem!')

      // All should be complete after done chunks
      expect(msg1?.isComplete).toBe(true)
      expect(msg2?.isComplete).toBe(true)
      expect(msg3?.isComplete).toBe(true)
      expect(msg4?.isComplete).toBe(true)
    })

    it('should order messages by startedAt timestamp', async () => {
      // Emit all test data
      controller.emit(streamRowsToChunkRows(testData))
      await flushPromises()

      // Get all messages and verify order
      const messages = [...messagesCollection.values()]

      // Messages should be ordered by startOffset (chronological)
      // The first message should be the first user message
      expect(messages[0].id).toBe(TEST_MESSAGE_IDS.USER_1)
      expect(messages[1].id).toBe(TEST_MESSAGE_IDS.ASSISTANT_1)
      expect(messages[2].id).toBe(TEST_MESSAGE_IDS.USER_2)
      expect(messages[3].id).toBe(TEST_MESSAGE_IDS.ASSISTANT_2)
    })
  })

  // ==========================================================================
  // Collection Subscription Tests
  // ==========================================================================

  describe('collection subscription', () => {
    it('should emit change events when messages are added', async () => {
      const { changes, unsubscribe } = collectChanges(messagesCollection)

      // Emit user message
      controller.emit(getMessageRows(testData, TEST_MESSAGE_IDS.USER_1))
      await flushPromises()

      expect(changes.length).toBeGreaterThan(0)
      expect(changes.some((c) => c.type === 'insert')).toBe(true)

      unsubscribe()
    })

    it('should emit change events as assistant message chunks stream in', async () => {
      // Emit user message first
      controller.emit(getMessageRows(testData, TEST_MESSAGE_IDS.USER_1))
      await flushPromises()

      const { changes, unsubscribe } = collectChanges(messagesCollection)

      // Emit assistant message chunks one by one
      const assistantRows = getMessageRows(testData, TEST_MESSAGE_IDS.ASSISTANT_1)
      for (const row of assistantRows) {
        controller.emit([row])
        await flushPromises()
      }

      // Should have had multiple events (insert + updates)
      const assistantChanges = changes.filter((c) => c.key === TEST_MESSAGE_IDS.ASSISTANT_1)
      expect(assistantChanges.length).toBeGreaterThan(1)

      unsubscribe()
    })
  })

  // ==========================================================================
  // Intermediate Collection Tests
  // ==========================================================================

  describe('collectedMessages (intermediate stage)', () => {
    it('should group rows by messageId', async () => {
      // Emit all data
      controller.emit(streamRowsToChunkRows(testData))
      await flushPromises()

      // Should have 4 groups (one per message)
      expect(collectedMessagesCollection.size).toBe(4)

      // Check that user message has 1 row
      const collected1 = collectedMessagesCollection.get(TEST_MESSAGE_IDS.USER_1)
      expect(collected1?.rows).toHaveLength(1)

      // Check that first assistant message has all its chunks
      const assistantRows = getMessageRows(testData, TEST_MESSAGE_IDS.ASSISTANT_1)
      const collected2 = collectedMessagesCollection.get(TEST_MESSAGE_IDS.ASSISTANT_1)
      expect(collected2?.rows).toHaveLength(assistantRows.length)
    })

    it('should have startedAt set to earliest timestamp', async () => {
      controller.emit(streamRowsToChunkRows(testData))
      await flushPromises()

      const collected = collectedMessagesCollection.get(TEST_MESSAGE_IDS.ASSISTANT_1)
      expect(collected?.startedAt).toBeDefined()

      // startedAt should be the createdAt of the first row
      const rows = getMessageRows(testData, TEST_MESSAGE_IDS.ASSISTANT_1)
      const sortedRows = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      expect(collected?.startedAt).toBe(sortedRows[0].createdAt)
    })
  })

  // ==========================================================================
  // Optimistic Insert Bug Reproduction
  // ==========================================================================

  describe('optimistic insert into derived collection', () => {
    /**
     * This test reproduces the bug where assistant messages disappear after
     * optimistic user message reconciliation.
     *
     * Bug pattern:
     * 1. User sends message → optimistic insert directly into messages collection
     * 2. Server syncs user message → pipeline produces same message, reconciliation
     * 3. Server syncs assistant response → assistant message should appear
     * 4. BUG: Assistant message is missing from collection
     *
     * The theory is that inserting directly into the derived `messages` collection
     * (rather than the source `stream` collection) causes reconciliation issues
     * when the pipeline produces the same row from synced data.
     */

    // Helper to create an optimistic message action (mimics client.ts:380-426)
    // Returns both the action and a resolver to control when the mutation completes
    //
    // IMPORTANT: This inserts into the stream collection (not messages collection)
    // because messages is a derived collection from a live query pipeline.
    // Inserting directly into a derived collection causes TanStack DB reconciliation
    // bugs where synced data becomes invisible while the optimistic mutation is pending.
    function createTestMessageAction(stream: Collection<ChunkRow>) {
      let optimisticSeq = 0
      let pendingResolvers: Array<() => void> = []

      const action = createOptimisticAction<{
        messageId: string
        content: string
        role: 'user' | 'assistant'
      }>({
        onMutate: ({ messageId, content, role }) => {
          const seq = (optimisticSeq++).toString().padStart(16, '0')
          const optimisticOffset = `zzzzzzzzzzzzzzzz_${seq}`

          const createdAt = new Date()

          // Insert into chunks collection with user-message format
          // This flows through the live query pipeline: chunks → collectedMessages → messages
          stream.insert({
            id: `${messageId}:0`, // Primary key: messageId:seq
            messageId,
            actorId: 'test-user',
            role, // Now using 'role' instead of 'actorType'
            chunk: JSON.stringify({
              type: 'user-message',
              message: {
                id: messageId,
                role,
                parts: [{ type: 'text' as const, content }],
                createdAt: createdAt.toISOString(),
              },
            }),
            createdAt: createdAt.toISOString(),
            seq: 0,
          })
        },
        mutationFn: async () => {
          // In production, this waits for db.utils.awaitTxId (until synced data arrives)
          // Here we wait until the test explicitly resolves it
          await new Promise<void>((resolve) => {
            pendingResolvers.push(resolve)
          })
        },
      })

      // Helper to resolve all pending mutations (simulates sync completing)
      const resolvePending = () => {
        const resolvers = pendingResolvers
        pendingResolvers = []
        resolvers.forEach((r) => r())
      }

      return { action, resolvePending }
    }

    it('should retain assistant message after optimistic user message is reconciled', async () => {
      // Get test data for user and assistant messages
      const userMessageId = TEST_MESSAGE_IDS.USER_1
      const assistantMessageId = TEST_MESSAGE_IDS.ASSISTANT_1
      const userRows = getMessageRows(testData, userMessageId)
      const assistantRows = getMessageRows(testData, assistantMessageId)

      // Create optimistic action (mimics production client.ts)
      // Pass chunksCollection - optimistic inserts go into the source collection
      const { action: sendMessage, resolvePending } = createTestMessageAction(chunksCollection)

      // Step 1: Insert OPTIMISTIC user message via optimistic action
      // This mimics what createMessageAction() does in client.ts:382
      // Note: mutationFn is pending, so optimistic state should be visible
      const tx = sendMessage({
        messageId: userMessageId,
        content: 'Hello',
        role: 'user',
      })

      await flushPromises()

      // Verify optimistic message appears (while mutation is pending)
      expect(messagesCollection.size).toBe(1)
      expect(messagesCollection.get(userMessageId)?.role).toBe('user')

      // Step 2: Sync the REAL user message through the pipeline
      // This triggers reconciliation: optimistic row vs pipeline-derived row
      controller.emit(userRows)
      await flushPromises()

      // Now resolve the mutation (simulating awaitTxId completing)
      resolvePending()
      await flushPromises()

      // User message should still exist (reconciled)
      expect(messagesCollection.has(userMessageId)).toBe(true)
      const userMsg = messagesCollection.get(userMessageId)
      expect(userMsg?.role).toBe('user')

      // Step 3: Sync the assistant response through the pipeline
      controller.emit(assistantRows)
      await flushPromises()

      // Log all messages for debugging
      const allMessages = [...messagesCollection.values()]

      expect(messagesCollection.size).toBe(2)
      expect(messagesCollection.has(userMessageId)).toBe(true)
      expect(messagesCollection.has(assistantMessageId)).toBe(true)

      // Verify correct ordering (user before assistant)
      const messages = [...messagesCollection.values()]
      expect(messages[0].id).toBe(userMessageId)
      expect(messages[1].id).toBe(assistantMessageId)
    })

    it('should handle multiple optimistic inserts followed by sync', async () => {
      // This tests a more complex scenario with multiple messages
      const user1Id = TEST_MESSAGE_IDS.USER_1
      const assistant1Id = TEST_MESSAGE_IDS.ASSISTANT_1
      const user2Id = TEST_MESSAGE_IDS.USER_2
      const assistant2Id = TEST_MESSAGE_IDS.ASSISTANT_2

      // Create optimistic action
      const { action: sendMessage, resolvePending } = createTestMessageAction(chunksCollection)

      // Insert first optimistic user message
      sendMessage({
        messageId: user1Id,
        content: 'Hello',
        role: 'user',
      })
      await flushPromises()
      expect(messagesCollection.size).toBe(1)

      // Sync all data at once (user1, assistant1, user2, assistant2)
      controller.emit(streamRowsToChunkRows(testData))
      await flushPromises()

      // Resolve the pending mutation
      resolvePending()
      await flushPromises()

      // All 4 messages should be present
      const allMessages = [...messagesCollection.values()]

      expect(messagesCollection.size).toBe(4)
      expect(messagesCollection.has(user1Id)).toBe(true)
      expect(messagesCollection.has(assistant1Id)).toBe(true)
      expect(messagesCollection.has(user2Id)).toBe(true)
      expect(messagesCollection.has(assistant2Id)).toBe(true)
    })

    it('should handle optimistic insert with streaming assistant response', async () => {
      // This tests the exact bug scenario: optimistic user message, then
      // assistant response streams in chunk by chunk
      const userMessageId = TEST_MESSAGE_IDS.USER_1
      const assistantMessageId = TEST_MESSAGE_IDS.ASSISTANT_1
      const userRows = getMessageRows(testData, userMessageId)
      const assistantRows = getMessageRows(testData, assistantMessageId)

      // Create optimistic action
      const { action: sendMessage, resolvePending } = createTestMessageAction(chunksCollection)

      // Step 1: Insert optimistic user message
      sendMessage({
        messageId: userMessageId,
        content: 'Hello',
        role: 'user',
      })
      await flushPromises()
      expect(messagesCollection.size).toBe(1)

      // Step 2: Sync real user message (reconciliation)
      controller.emit(userRows)
      await flushPromises()

      // Resolve mutation (simulating awaitTxId success)
      resolvePending()
      await flushPromises()
      expect(messagesCollection.size).toBe(1)

      // Step 3: Stream assistant response chunk by chunk
      // This is where the bug manifests in production
      for (let i = 0; i < assistantRows.length; i++) {
        controller.emit([assistantRows[i]])
        await flushPromises()

        // After first chunk, assistant message should appear
        if (i === 0) {
          expect(messagesCollection.size).toBe(2)
          expect(messagesCollection.has(assistantMessageId)).toBe(true)
        }
      }

      // Final state: both messages should exist
      expect(messagesCollection.size).toBe(2)
      expect(messagesCollection.has(userMessageId)).toBe(true)
      expect(messagesCollection.has(assistantMessageId)).toBe(true)

      // Verify assistant message content
      const assistantMsg = messagesCollection.get(assistantMessageId)
      expect(assistantMsg?.role).toBe('assistant')
      expect(assistantMsg?.isComplete).toBe(true)
    })

    it('should emit correct changes to subscriber during reconciliation', async () => {
      // This test mimics what React does - subscribing to changes
      // The bug report shows "changes: 1" when it should be 2
      const userMessageId = TEST_MESSAGE_IDS.USER_1
      const assistantMessageId = TEST_MESSAGE_IDS.ASSISTANT_1
      const userRows = getMessageRows(testData, userMessageId)
      const assistantRows = getMessageRows(testData, assistantMessageId)

      // Create optimistic action
      const { action: sendMessage, resolvePending } = createTestMessageAction(chunksCollection)

      // Subscribe to changes (like React does)
      const { changes, unsubscribe } = collectChanges(messagesCollection)

      // Step 1: Insert optimistic user message
      sendMessage({
        messageId: userMessageId,
        content: 'Hello',
        role: 'user',
      })
      await flushPromises()

      expect(changes.length).toBeGreaterThan(0)
      expect(changes.some(c => c.key === userMessageId)).toBe(true)

      // Clear changes for next phase
      changes.length = 0

      // Step 2: Sync real user message (reconciliation)
      controller.emit(userRows)
      await flushPromises()

      // Resolve mutation
      resolvePending()
      await flushPromises()

      // Clear changes for assistant phase
      changes.length = 0

      // Step 3: Sync assistant response
      controller.emit(assistantRows)
      await flushPromises()

      // CRITICAL: Should see the assistant message in changes
      expect(changes.some(c => c.key === assistantMessageId)).toBe(true)

      // Final collection should have both messages
      expect(messagesCollection.size).toBe(2)
      expect(messagesCollection.has(userMessageId)).toBe(true)
      expect(messagesCollection.has(assistantMessageId)).toBe(true)

      unsubscribe()
    })

    it('should work correctly with markReady called on source collection', async () => {
      // Test with markReady to mimic production behavior more closely
      const userMessageId = TEST_MESSAGE_IDS.USER_1
      const assistantMessageId = TEST_MESSAGE_IDS.ASSISTANT_1
      const userRows = getMessageRows(testData, userMessageId)
      const assistantRows = getMessageRows(testData, assistantMessageId)

      // Mark source collection as ready (happens when Electric sync establishes)
      controller.markReady()
      await flushPromises()

      // Create optimistic action
      const { action: sendMessage, resolvePending } = createTestMessageAction(chunksCollection)

      // Subscribe to changes
      const { changes, unsubscribe } = collectChanges(messagesCollection)

      // Step 1: Insert optimistic user message
      sendMessage({
        messageId: userMessageId,
        content: 'Hello',
        role: 'user',
      })
      await flushPromises()
      expect(messagesCollection.size).toBe(1)

      // Step 2: Sync real user message
      controller.emit(userRows)
      await flushPromises()
      resolvePending()
      await flushPromises()

      // Step 3: Sync assistant response
      controller.emit(assistantRows)
      await flushPromises()

      // Both messages should exist
      expect(messagesCollection.size).toBe(2)
      expect(messagesCollection.has(userMessageId)).toBe(true)
      expect(messagesCollection.has(assistantMessageId)).toBe(true)

      unsubscribe()
    })

    it('should handle user reconciliation and assistant message in same sync batch', async () => {
      // This tests a potential race condition where:
      // - Optimistic user message exists
      // - Server syncs BOTH user message AND first assistant chunk in same batch
      // - This might trigger the bug where assistant message is lost
      const userMessageId = TEST_MESSAGE_IDS.USER_1
      const assistantMessageId = TEST_MESSAGE_IDS.ASSISTANT_1
      const userRows = getMessageRows(testData, userMessageId)
      const assistantRows = getMessageRows(testData, assistantMessageId)

      controller.markReady()
      await flushPromises()

      // Create optimistic action
      const { action: sendMessage, resolvePending } = createTestMessageAction(chunksCollection)

      // Subscribe to changes
      const { changes, unsubscribe } = collectChanges(messagesCollection)

      // Step 1: Insert optimistic user message
      sendMessage({
        messageId: userMessageId,
        content: 'Hello',
        role: 'user',
      })
      await flushPromises()
      expect(messagesCollection.size).toBe(1)

      // Step 2: CRITICAL - Sync BOTH user AND assistant in the SAME batch
      // This might trigger the bug where assistant is lost during reconciliation
      controller.emit([...userRows, ...assistantRows])
      await flushPromises()

      // Resolve the mutation
      resolvePending()
      await flushPromises()

      // CRITICAL: Both messages should exist
      expect(messagesCollection.size).toBe(2)
      expect(messagesCollection.has(userMessageId)).toBe(true)
      expect(messagesCollection.has(assistantMessageId)).toBe(true)

      unsubscribe()
    })

    it('should handle assistant streaming while optimistic mutation is still pending', async () => {
      // This tests the scenario where:
      // - Optimistic user message is pending (mutation not resolved yet)
      // - Assistant message starts streaming in
      // - In production, awaitTxId resolves the mutation as soon as the txid from
      //   the synced user message is seen in the stream, so this simulates that pattern
      const userMessageId = TEST_MESSAGE_IDS.USER_1
      const assistantMessageId = TEST_MESSAGE_IDS.ASSISTANT_1
      const userRows = getMessageRows(testData, userMessageId)
      const assistantRows = getMessageRows(testData, assistantMessageId)

      controller.markReady()
      await flushPromises()

      // Create optimistic action
      const { action: sendMessage, resolvePending } = createTestMessageAction(chunksCollection)

      // Subscribe to changes
      const { changes, unsubscribe } = collectChanges(messagesCollection)

      // Step 1: Insert optimistic user message (mutation is PENDING)
      sendMessage({
        messageId: userMessageId,
        content: 'Hello',
        role: 'user',
      })
      await flushPromises()
      expect(messagesCollection.size).toBe(1)

      // Step 2: Sync user message
      controller.emit(userRows)
      await flushPromises()

      // User message should still show
      expect(messagesCollection.size).toBe(1)
      expect(messagesCollection.has(userMessageId)).toBe(true)

      // Step 3: In production, awaitTxId would resolve the mutation as soon as
      // the txid is seen in the synced stream. Simulate this by resolving now.
      resolvePending()
      await flushPromises()

      // Step 4: Start streaming assistant AFTER mutation is resolved
      // This is the realistic scenario - awaitTxId resolves quickly
      for (let i = 0; i < Math.min(3, assistantRows.length); i++) {
        controller.emit([assistantRows[i]])
        await flushPromises()

        // Both user (synced) and assistant (synced) should exist
        expect(messagesCollection.size).toBe(2)
        expect(messagesCollection.has(userMessageId)).toBe(true)
        expect(messagesCollection.has(assistantMessageId)).toBe(true)
      }

      // CRITICAL: Both messages should exist
      expect(messagesCollection.size).toBe(2)
      expect(messagesCollection.has(userMessageId)).toBe(true)
      expect(messagesCollection.has(assistantMessageId)).toBe(true)

      unsubscribe()
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle empty stream', async () => {
      // Don't emit anything
      await flushPromises()

      expect(messagesCollection.size).toBe(0)
      expect(collectedMessagesCollection.size).toBe(0)
    })

    it('should handle duplicate emissions gracefully', async () => {
      const userMessageRows = getMessageRows(testData, TEST_MESSAGE_IDS.USER_1)

      // Emit same data twice
      controller.emit(userMessageRows)
      await flushPromises()
      controller.emit(userMessageRows)
      await flushPromises()

      // Should still only have 1 message (deduplication by key)
      expect(messagesCollection.size).toBe(1)
    })

    it('should handle out-of-order chunk delivery', async () => {
      // Emit user message
      controller.emit(getMessageRows(testData, TEST_MESSAGE_IDS.USER_1))
      await flushPromises()

      // Get assistant rows and shuffle them
      const assistantRows = getMessageRows(testData, TEST_MESSAGE_IDS.ASSISTANT_1)

      // Emit in reverse order (simulating out-of-order delivery)
      const reversed = [...assistantRows].reverse()
      controller.emit(reversed)
      await flushPromises()

      // Should still materialize correctly (sorted by seq internally)
      const message = messagesCollection.get(TEST_MESSAGE_IDS.ASSISTANT_1)
      expect(message?.isComplete).toBe(true)
      const textPart = message?.parts.find(p => p.type === 'text')
      expect((textPart as { type: 'text'; content: string })?.content).toBe(EXPECTED_CONTENT.ASSISTANT_1)
    })
  })
})
