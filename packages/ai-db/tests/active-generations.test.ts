/**
 * Tests for the active generations collection.
 *
 * Verifies that incomplete messages (currently being streamed) are tracked
 * correctly in the activeGenerations collection.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createMockStreamCollection,
  loadTestData,
  addOffsets,
  getMessageRows,
  flushPromises,
  TEST_MESSAGE_IDS,
} from './fixtures/test-helpers'
import {
  createCollectedMessagesCollection,
  createMessagesCollection,
} from '../src/collections/messages'
import { createActiveGenerationsCollection } from '../src/collections/active-generations'
import type { StreamRowWithOffset, MessageRow, ActiveGenerationRow } from '../src/types'
import type { Collection } from '@tanstack/db'

describe('active generations collection', () => {
  const testData = loadTestData()

  // Collections to be set up in beforeEach
  let streamCollection: Collection<StreamRowWithOffset>
  let controller: ReturnType<typeof createMockStreamCollection>['controller']
  let messagesCollection: Collection<MessageRow>
  let activeGenerations: Collection<ActiveGenerationRow>

  beforeEach(() => {
    // Create mock stream collection
    const mock = createMockStreamCollection('test-session')
    streamCollection = mock.collection
    controller = mock.controller

    // Create the pipeline: stream -> collectedMessages -> messages -> activeGenerations
    // Note: derived collections use startSync: true, so they start syncing immediately
    const collectedMessagesCollection = createCollectedMessagesCollection({
      sessionId: 'test-session',
      streamCollection,
    })

    messagesCollection = createMessagesCollection({
      sessionId: 'test-session',
      collectedMessagesCollection,
    })

    activeGenerations = createActiveGenerationsCollection({
      sessionId: 'test-session',
      messagesCollection,
    })

    // Initialize stream collection
    streamCollection.preload()
    controller.markReady()
  })

  // ==========================================================================
  // Basic Active Generation Tracking
  // ==========================================================================

  describe('basic tracking', () => {
    it('should have no active generations initially', async () => {
      await flushPromises()
      expect(activeGenerations.size).toBe(0)
    })

    it('should not track user messages as active generations', async () => {
      // Emit a complete user message
      const userRows = addOffsets(getMessageRows(testData, TEST_MESSAGE_IDS.USER_1), 0)
      controller.emit(userRows)
      await flushPromises()

      // User messages are complete, so no active generation
      expect(activeGenerations.size).toBe(0)
    })

    it('should track an assistant message while streaming', async () => {
      // First emit user message
      controller.emit(addOffsets(getMessageRows(testData, TEST_MESSAGE_IDS.USER_1), 0))
      await flushPromises()

      // Emit first assistant chunk (not done)
      const assistantRows = addOffsets(getMessageRows(testData, TEST_MESSAGE_IDS.ASSISTANT_1), 100)
      controller.emit([assistantRows[0]])
      await flushPromises()

      // Should now have an active generation
      expect(activeGenerations.size).toBe(1)
      const activeGen = activeGenerations.get(TEST_MESSAGE_IDS.ASSISTANT_1)
      expect(activeGen).toBeDefined()
      expect(activeGen?.messageId).toBe(TEST_MESSAGE_IDS.ASSISTANT_1)
    })

    it('should update active generation as deltas arrive', async () => {
      // Set up user message
      controller.emit(addOffsets(getMessageRows(testData, TEST_MESSAGE_IDS.USER_1), 0))
      await flushPromises()

      // Get assistant rows
      const assistantRows = addOffsets(getMessageRows(testData, TEST_MESSAGE_IDS.ASSISTANT_1), 100)

      // Emit chunks one by one (excluding last done chunk)
      for (let i = 0; i < assistantRows.length - 1; i++) {
        controller.emit([assistantRows[i]])
        await flushPromises()

        // Should still be active
        expect(activeGenerations.size).toBe(1)
        const updated = activeGenerations.get(TEST_MESSAGE_IDS.ASSISTANT_1)
        expect(updated?.messageId).toBe(TEST_MESSAGE_IDS.ASSISTANT_1)
      }
    })

    it('should remove active generation when done chunk arrives', async () => {
      // Set up user message
      controller.emit(addOffsets(getMessageRows(testData, TEST_MESSAGE_IDS.USER_1), 0))
      await flushPromises()

      // Emit all assistant chunks including done
      const assistantRows = addOffsets(getMessageRows(testData, TEST_MESSAGE_IDS.ASSISTANT_1), 100)
      controller.emit(assistantRows)
      await flushPromises()

      // Should no longer be active
      expect(activeGenerations.size).toBe(0)
    })
  })

  // ==========================================================================
  // Multiple Active Generations
  // ==========================================================================

  describe('multiple concurrent generations', () => {
    it('should track multiple incomplete assistant messages', async () => {
      // Create custom test data with two concurrent incomplete generations
      const gen1Row: StreamRowWithOffset = {
        sessionId: 'test-session',
        messageId: 'gen-1',
        actorId: 'agent-1',
        actorType: 'agent',
        chunk: JSON.stringify({
          type: 'content',
          delta: 'Hello',
          content: 'Hello',
          role: 'assistant',
          id: 'gen-1',
          model: 'test',
          timestamp: Date.now(),
        }),
        createdAt: new Date().toISOString(),
        seq: 0,
        offset: 'offset-0000000001',
      }

      const gen2Row: StreamRowWithOffset = {
        sessionId: 'test-session',
        messageId: 'gen-2',
        actorId: 'agent-2',
        actorType: 'agent',
        chunk: JSON.stringify({
          type: 'content',
          delta: 'World',
          content: 'World',
          role: 'assistant',
          id: 'gen-2',
          model: 'test',
          timestamp: Date.now(),
        }),
        createdAt: new Date().toISOString(),
        seq: 0,
        offset: 'offset-0000000002',
      }

      // Emit both generation starts
      controller.emit([gen1Row, gen2Row])
      await flushPromises()

      // Both should be active (neither has a done chunk)
      expect(activeGenerations.size).toBe(2)
      expect(activeGenerations.has('gen-1')).toBe(true)
      expect(activeGenerations.has('gen-2')).toBe(true)
    })

    it('should remove only the completed generation', async () => {
      // Create two incomplete generations
      const gen1Content: StreamRowWithOffset = {
        sessionId: 'test-session',
        messageId: 'gen-1',
        actorId: 'agent-1',
        actorType: 'agent',
        chunk: JSON.stringify({
          type: 'content',
          delta: 'Hello',
          content: 'Hello',
          role: 'assistant',
          id: 'gen-1',
          model: 'test',
          timestamp: Date.now(),
        }),
        createdAt: new Date().toISOString(),
        seq: 0,
        offset: 'offset-0000000001',
      }

      const gen2Content: StreamRowWithOffset = {
        sessionId: 'test-session',
        messageId: 'gen-2',
        actorId: 'agent-2',
        actorType: 'agent',
        chunk: JSON.stringify({
          type: 'content',
          delta: 'World',
          content: 'World',
          role: 'assistant',
          id: 'gen-2',
          model: 'test',
          timestamp: Date.now(),
        }),
        createdAt: new Date().toISOString(),
        seq: 0,
        offset: 'offset-0000000002',
      }

      controller.emit([gen1Content, gen2Content])
      await flushPromises()

      expect(activeGenerations.size).toBe(2)

      // Complete gen-1 with a done chunk
      const gen1Done: StreamRowWithOffset = {
        sessionId: 'test-session',
        messageId: 'gen-1',
        actorId: 'agent-1',
        actorType: 'agent',
        chunk: JSON.stringify({
          type: 'done',
          id: 'gen-1',
          model: 'test',
          timestamp: Date.now(),
          finishReason: 'stop',
        }),
        createdAt: new Date().toISOString(),
        seq: 1,
        offset: 'offset-0000000003',
      }

      controller.emit([gen1Done])
      await flushPromises()

      // Only gen-1 should be removed
      expect(activeGenerations.size).toBe(1)
      expect(activeGenerations.has('gen-1')).toBe(false)
      expect(activeGenerations.has('gen-2')).toBe(true)
    })
  })

  // ==========================================================================
  // Active Generation Properties
  // ==========================================================================

  describe('active generation properties', () => {
    it('should have correct messageId', async () => {
      // Emit incomplete assistant message
      const assistantRows = addOffsets(getMessageRows(testData, TEST_MESSAGE_IDS.ASSISTANT_1), 0)
      controller.emit([assistantRows[0]])
      await flushPromises()

      const gen = activeGenerations.get(TEST_MESSAGE_IDS.ASSISTANT_1)
      expect(gen?.messageId).toBe(TEST_MESSAGE_IDS.ASSISTANT_1)
    })

    it('should have correct actorId', async () => {
      const assistantRows = addOffsets(getMessageRows(testData, TEST_MESSAGE_IDS.ASSISTANT_1), 0)
      controller.emit([assistantRows[0]])
      await flushPromises()

      const gen = activeGenerations.get(TEST_MESSAGE_IDS.ASSISTANT_1)
      // actorId should match the stream row
      expect(gen?.actorId).toBe('openai-chat')
    })

    it('should have startedAt timestamp', async () => {
      const assistantRows = addOffsets(getMessageRows(testData, TEST_MESSAGE_IDS.ASSISTANT_1), 0)
      controller.emit([assistantRows[0]])
      await flushPromises()

      const gen = activeGenerations.get(TEST_MESSAGE_IDS.ASSISTANT_1)
      expect(gen?.startedAt).toBeInstanceOf(Date)
    })
  })

  // ==========================================================================
  // Integration with isLoading
  // ==========================================================================

  describe('integration with isLoading pattern', () => {
    it('should allow checking isLoading via collection size', async () => {
      // Initially not loading
      expect(activeGenerations.size > 0).toBe(false)

      // Start streaming
      const assistantRows = addOffsets(getMessageRows(testData, TEST_MESSAGE_IDS.ASSISTANT_1), 0)
      controller.emit([assistantRows[0]])
      await flushPromises()

      // Now loading
      expect(activeGenerations.size > 0).toBe(true)

      // Complete the message
      controller.emit(assistantRows.slice(1))
      await flushPromises()

      // No longer loading
      expect(activeGenerations.size > 0).toBe(false)
    })
  })

  // ==========================================================================
  // Full Conversation Test
  // ==========================================================================

  describe('full conversation flow', () => {
    it('should track active generations throughout conversation', async () => {
      const assistantRows1 = getMessageRows(testData, TEST_MESSAGE_IDS.ASSISTANT_1)
      const assistantRows2 = getMessageRows(testData, TEST_MESSAGE_IDS.ASSISTANT_2)

      // 1. User sends message - no active generation
      controller.emit(addOffsets(getMessageRows(testData, TEST_MESSAGE_IDS.USER_1), 0))
      await flushPromises()
      expect(activeGenerations.size).toBe(0)

      // 2. Assistant starts responding - active generation
      controller.emit(addOffsets([assistantRows1[0]], 100))
      await flushPromises()
      expect(activeGenerations.size).toBe(1)

      // 3. Assistant finishes - no active generation
      controller.emit(addOffsets(assistantRows1.slice(1), 101))
      await flushPromises()
      expect(activeGenerations.size).toBe(0)

      // 4. User sends another message - no active generation
      controller.emit(addOffsets(getMessageRows(testData, TEST_MESSAGE_IDS.USER_2), 200))
      await flushPromises()
      expect(activeGenerations.size).toBe(0)

      // 5. Second assistant response starts - active generation
      controller.emit(addOffsets([assistantRows2[0]], 300))
      await flushPromises()
      expect(activeGenerations.size).toBe(1)

      // 6. Second assistant finishes - no active generation
      controller.emit(addOffsets(assistantRows2.slice(1), 301))
      await flushPromises()
      expect(activeGenerations.size).toBe(0)
    })
  })
})
