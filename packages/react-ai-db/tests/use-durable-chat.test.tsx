/**
 * Integration tests for useDurableChat React hook.
 *
 * These tests verify the full integration between:
 * - React hook (useDurableChat)
 * - DurableChatClient
 * - Live query pipeline (stream → collectedMessages → messages)
 *
 * We inject a mock stream collection into the client, using the same
 * pattern as the ai-db tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { DurableChatClient } from '@electric-sql/ai-db'
import { useDurableChat } from '../src/use-durable-chat'
import type { UIMessage } from '@tanstack/ai'

// Import test helpers from ai-db
import {
  createMockSessionDB,
  loadTestData,
  getMessageRows,
  flushPromises,
  TEST_MESSAGE_IDS,
  EXPECTED_CONTENT,
  type MockSessionDBControllers,
} from '../../ai-db/tests/fixtures/test-helpers'

describe('useDurableChat integration', () => {
  const testData = loadTestData()

  // Mock session DB and client to be set up in beforeEach
  let mockSessionDB: ReturnType<typeof createMockSessionDB>
  let controllers: MockSessionDBControllers
  let client: DurableChatClient

  beforeEach(async () => {
    // Create mock session DB with controllers for all collections
    mockSessionDB = createMockSessionDB('test-session')
    controllers = mockSessionDB.controllers

    // Create real client with injected mock session DB
    client = new DurableChatClient({
      sessionId: 'test-session',
      proxyUrl: 'http://localhost:4000',
      sessionDB: mockSessionDB.sessionDB,
    })

    // Connect the client - this calls sessionDB.preload() which sets up collections
    // After connect, the hook will detect connectionStatus === 'connected' and set up subscriptions
    await client.connect()
  })

  afterEach(() => {
    client.dispose()
  })

  describe('initial state', () => {
    it('should return empty messages array initially', async () => {
      const { result } = renderHook(() => useDurableChat({ client, autoConnect: false }))

      expect(result.current.messages).toEqual([])
    })

    it('should not be loading initially', () => {
      const { result } = renderHook(() => useDurableChat({ client, autoConnect: false }))

      expect(result.current.isLoading).toBe(false)
    })

    it('should have no error initially', () => {
      const { result } = renderHook(() => useDurableChat({ client, autoConnect: false }))

      expect(result.current.error).toBeUndefined()
    })

    it('should have connected connection status when client is pre-connected', () => {
      // Client is pre-connected in beforeEach, hook detects this and sets up subscriptions
      const { result } = renderHook(() => useDurableChat({ client, autoConnect: false }))

      expect(result.current.connectionStatus).toBe('connected')
    })
  })

  describe('API functions availability', () => {
    it('should provide all TanStack AI compatible functions', () => {
      const { result } = renderHook(() => useDurableChat({ client, autoConnect: false }))

      expect(typeof result.current.sendMessage).toBe('function')
      expect(typeof result.current.append).toBe('function')
      expect(typeof result.current.reload).toBe('function')
      expect(typeof result.current.stop).toBe('function')
      expect(typeof result.current.clear).toBe('function')
      expect(typeof result.current.addToolResult).toBe('function')
      expect(typeof result.current.addToolApprovalResponse).toBe('function')
    })

    it('should provide durable-specific functions', () => {
      const { result } = renderHook(() => useDurableChat({ client, autoConnect: false }))

      expect(typeof result.current.fork).toBe('function')
      expect(typeof result.current.registerAgents).toBe('function')
      expect(typeof result.current.unregisterAgent).toBe('function')
      expect(typeof result.current.connect).toBe('function')
      expect(typeof result.current.disconnect).toBe('function')
      expect(typeof result.current.pause).toBe('function')
      expect(typeof result.current.resume).toBe('function')
    })

    it('should expose client and collections', () => {
      const { result } = renderHook(() => useDurableChat({ client, autoConnect: false }))

      expect(result.current.client).toBe(client)
      expect(result.current.collections).toBeDefined()
      expect(result.current.collections.messages).toBeDefined()
      expect(result.current.collections.activeGenerations).toBeDefined()
      expect(result.current.collections.chunks).toBeDefined()
    })
  })

  describe('message materialization via live query pipeline', () => {
    it('should materialize a user message from stream data', async () => {
      const { result } = renderHook(() => useDurableChat({ client, autoConnect: false }))

      // Emit user message (wrapped in act for React state updates)
      const userMessageRows = getMessageRows(testData, TEST_MESSAGE_IDS.USER_1)
      await act(async () => {
        controllers.chunks.emit(userMessageRows)
        await flushPromises()
      })

      // Verify message materialized in hook
      await waitFor(() => {
        expect(result.current.messages.length).toBe(1)
      })

      const message = result.current.messages[0]
      expect(message.id).toBe(TEST_MESSAGE_IDS.USER_1)
      expect(message.role).toBe('user')
    })

    it('should materialize user + assistant messages in correct order', async () => {
      const { result } = renderHook(() => useDurableChat({ client, autoConnect: false }))

      // Emit user message
      await act(async () => {
        controllers.chunks.emit(getMessageRows(testData, TEST_MESSAGE_IDS.USER_1))
        await flushPromises()
      })

      await waitFor(() => {
        expect(result.current.messages.length).toBe(1)
      })

      // Emit assistant response (all chunks)
      await act(async () => {
        controllers.chunks.emit(getMessageRows(testData, TEST_MESSAGE_IDS.ASSISTANT_1))
        await flushPromises()
      })

      await waitFor(() => {
        expect(result.current.messages.length).toBe(2)
      })

      // Verify order and roles
      expect(result.current.messages[0].role).toBe('user')
      expect(result.current.messages[1].role).toBe('assistant')
    })

    it('should handle full conversation flow', async () => {
      const { result } = renderHook(() => useDurableChat({ client, autoConnect: false }))

      // Emit all test data at once (simulates reconnect/catch-up)
      await act(async () => {
        controllers.chunks.emit(getMessageRows(testData, TEST_MESSAGE_IDS.USER_1).concat(
          getMessageRows(testData, TEST_MESSAGE_IDS.ASSISTANT_1),
          getMessageRows(testData, TEST_MESSAGE_IDS.USER_2),
          getMessageRows(testData, TEST_MESSAGE_IDS.ASSISTANT_2)
        ))
        await flushPromises()
      })

      await waitFor(() => {
        expect(result.current.messages.length).toBe(4)
      })

      // Verify message order
      expect(result.current.messages[0].id).toBe(TEST_MESSAGE_IDS.USER_1)
      expect(result.current.messages[1].id).toBe(TEST_MESSAGE_IDS.ASSISTANT_1)
      expect(result.current.messages[2].id).toBe(TEST_MESSAGE_IDS.USER_2)
      expect(result.current.messages[3].id).toBe(TEST_MESSAGE_IDS.ASSISTANT_2)

      // Verify roles
      expect(result.current.messages[0].role).toBe('user')
      expect(result.current.messages[1].role).toBe('assistant')
      expect(result.current.messages[2].role).toBe('user')
      expect(result.current.messages[3].role).toBe('assistant')
    })
  })

  describe('streaming updates', () => {
    it('should update messages reactively as chunks stream in', async () => {
      const { result } = renderHook(() => useDurableChat({ client, autoConnect: false }))

      // Emit user message first
      await act(async () => {
        controllers.chunks.emit(getMessageRows(testData, TEST_MESSAGE_IDS.USER_1))
        await flushPromises()
      })

      await waitFor(() => {
        expect(result.current.messages.length).toBe(1)
      })

      // Emit assistant chunks one by one
      const assistantRows = getMessageRows(testData, TEST_MESSAGE_IDS.ASSISTANT_1)

      // First chunk - message appears
      await act(async () => {
        controllers.chunks.emit([assistantRows[0]])
        await flushPromises()
      })

      await waitFor(() => {
        expect(result.current.messages.length).toBe(2)
      })

      // Middle chunks - content updates
      for (let i = 1; i < assistantRows.length - 1; i++) {
        await act(async () => {
          controllers.chunks.emit([assistantRows[i]])
          await flushPromises()
        })
      }

      // Final chunk - message completes
      await act(async () => {
        controllers.chunks.emit([assistantRows[assistantRows.length - 1]])
        await flushPromises()
      })

      // Message should still be there
      expect(result.current.messages.length).toBe(2)
    })

    /**
     * CRITICAL TEST: Verify that message text content updates incrementally as chunks stream in.
     *
     * This test verifies the core streaming behavior:
     * 1. As each chunk arrives, the message content should grow
     * 2. The React hook should re-render with updated content
     * 3. The final content should match the expected full text
     *
     * Test data chunks build up content like:
     * - seq 0: "" (empty)
     * - seq 1: "Hi"
     * - seq 2: "Hi there"
     * - seq 3: "Hi there!"
     * - ... and so on to "Hi there! How can I assist you today?"
     */
    it('should update message TEXT CONTENT incrementally as chunks stream in', async () => {
      const { result } = renderHook(() => useDurableChat({ client, autoConnect: false }))

      // Helper to extract text content from a message
      const getTextContent = (message: UIMessage): string => {
        const textParts = message.parts.filter(p => p.type === 'text')
        return textParts.map(p => (p as { type: 'text'; text?: string; content?: string }).text ?? (p as { type: 'text'; content?: string }).content ?? '').join('')
      }

      // Emit user message first
      await act(async () => {
        controllers.chunks.emit(getMessageRows(testData, TEST_MESSAGE_IDS.USER_1))
        await flushPromises()
      })

      await waitFor(() => {
        expect(result.current.messages.length).toBe(1)
      })

      // Get assistant chunks - these build up content incrementally
      // Test data structure:
      // - seq 0: content="" (initial empty chunk)
      // - seq 1-10: content="Hi", "Hi there", "Hi there!", ... (accumulating)
      // - seq 11: done chunk (finishReason="stop")
      const assistantRows = getMessageRows(testData, TEST_MESSAGE_IDS.ASSISTANT_1)

      // Track content at each chunk
      const contentUpdates: string[] = []

      // Emit chunks one by one and verify content grows
      for (let i = 0; i < assistantRows.length; i++) {
        await act(async () => {
          controllers.chunks.emit([assistantRows[i]])
          await flushPromises()
        })

        // Wait for the assistant message to appear/update
        await waitFor(() => {
          expect(result.current.messages.length).toBe(2)
        })

        const assistantMessage = result.current.messages.find(m => m.role === 'assistant')
        expect(assistantMessage).toBeDefined()

        const currentContent = getTextContent(assistantMessage!)
        contentUpdates.push(currentContent)
      }

      // CRITICAL ASSERTION: Verify content ACTUALLY accumulates
      // For chunks 1-10 (after initial empty, before done), content should STRICTLY grow
      // The test data has:
      // - chunk 0: empty ""
      // - chunk 1: "Hi"
      // - chunk 2: "Hi there"
      // - ... and so on
      for (let i = 2; i <= 10; i++) {
        const previousContent = contentUpdates[i - 1]
        const currentContent = contentUpdates[i]
        expect(currentContent.length).toBeGreaterThan(
          previousContent.length,
          `Content should grow at chunk ${i}: was "${previousContent}" (${previousContent.length}), got "${currentContent}" (${currentContent.length})`
        )
      }

      // Verify we got unique content values at each step (not all the same)
      const uniqueContents = new Set(contentUpdates.slice(0, 11)) // Exclude done chunk
      expect(uniqueContents.size).toBe(11) // Each of the 11 content chunks should be unique

      // Verify final content is complete
      const finalAssistant = result.current.messages.find(m => m.role === 'assistant')
      expect(getTextContent(finalAssistant!)).toBe(EXPECTED_CONTENT.ASSISTANT_1)
    })

    /**
     * Test rapid chunk arrival (simulating production conditions).
     *
     * In production, chunks may arrive in quick succession. This test emits
     * all chunks in rapid fire (no delays between) to verify the behavior.
     */
    it('should handle rapid chunk arrival (all chunks emitted quickly)', async () => {
      const { result } = renderHook(() => useDurableChat({ client, autoConnect: false }))

      // Helper to extract text content from a message
      const getTextContent = (message: UIMessage): string => {
        const textParts = message.parts.filter(p => p.type === 'text')
        return textParts.map(p => (p as { type: 'text'; text?: string; content?: string }).text ?? (p as { type: 'text'; content?: string }).content ?? '').join('')
      }

      // Emit user message first
      await act(async () => {
        controllers.chunks.emit(getMessageRows(testData, TEST_MESSAGE_IDS.USER_1))
        await flushPromises()
      })

      await waitFor(() => {
        expect(result.current.messages.length).toBe(1)
      })

      // Get all assistant chunks
      const assistantRows = getMessageRows(testData, TEST_MESSAGE_IDS.ASSISTANT_1)

      // Emit ALL chunks in a single batch (no delays between)
      await act(async () => {
        for (const row of assistantRows) {
          controllers.chunks.emit([row])
        }
        await flushPromises()
      })

      // Should have both messages
      await waitFor(() => {
        expect(result.current.messages.length).toBe(2)
      })

      // Final content should be complete
      const finalAssistant = result.current.messages.find(m => m.role === 'assistant')
      expect(getTextContent(finalAssistant!)).toBe(EXPECTED_CONTENT.ASSISTANT_1)

      // Note: With rapid arrival, we expect the final content to be correct,
      // but the intermediate streaming updates might be batched/skipped.
      // This is the expected behavior for rapid chunk arrival.
    })

    /**
     * Test subscription fire count vs actual content states observed.
     *
     * This test verifies how many times setMessages is actually called
     * vs how many unique content states we can observe. If React batches
     * updates, we'll see fewer unique states than subscription fires.
     */
    it('should track subscription fires vs content updates observed', async () => {
      // Track how many times subscription fires vs renders
      let subscriptionFireCount = 0
      const observedContents: string[] = []

      const { result } = renderHook(() => {
        const hook = useDurableChat({ client, autoConnect: false })
        // Track observed content on each render
        const assistantMsg = hook.messages.find(m => m.role === 'assistant')
        if (assistantMsg) {
          const textParts = assistantMsg.parts.filter(p => p.type === 'text')
          const content = textParts.map(p => (p as { type: 'text'; content?: string }).content ?? '').join('')
          if (observedContents[observedContents.length - 1] !== content) {
            observedContents.push(content)
          }
        }
        return hook
      })

      // Patch subscribeChanges to count fires
      const originalSubscribe = client.collections.messages.subscribeChanges.bind(client.collections.messages)
      client.collections.messages.subscribeChanges = (cb) => {
        return originalSubscribe((changes) => {
          subscriptionFireCount++
          cb(changes)
        })
      }

      // Emit user message first
      await act(async () => {
        controllers.chunks.emit(getMessageRows(testData, TEST_MESSAGE_IDS.USER_1))
        await flushPromises()
      })

      await waitFor(() => {
        expect(result.current.messages.length).toBe(1)
      })

      // Reset counters
      subscriptionFireCount = 0
      observedContents.length = 0

      // Emit assistant chunks WITH delays (should show all states)
      const assistantRows = getMessageRows(testData, TEST_MESSAGE_IDS.ASSISTANT_1)
      for (const row of assistantRows) {
        await act(async () => {
          controllers.chunks.emit([row])
          await flushPromises()
        })
      }

      // With delays, we should observe close to all unique states
      expect(observedContents.length).toBeGreaterThan(8) // Most of the 11 unique states
    })

    /**
     * Test ALL chunks in a single transaction (simulating batch sync).
     *
     * When all chunks arrive in a single sync transaction, we should still
     * get the complete message content.
     */
    it('should handle all chunks in a single transaction (batch sync)', async () => {
      const { result } = renderHook(() => useDurableChat({ client, autoConnect: false }))

      // Helper to extract text content from a message
      const getTextContent = (message: UIMessage): string => {
        const textParts = message.parts.filter(p => p.type === 'text')
        return textParts.map(p => (p as { type: 'text'; text?: string; content?: string }).text ?? (p as { type: 'text'; content?: string }).content ?? '').join('')
      }

      // Emit user message first
      await act(async () => {
        controllers.chunks.emit(getMessageRows(testData, TEST_MESSAGE_IDS.USER_1))
        await flushPromises()
      })

      await waitFor(() => {
        expect(result.current.messages.length).toBe(1)
      })

      // Get all assistant chunks
      const assistantRows = getMessageRows(testData, TEST_MESSAGE_IDS.ASSISTANT_1)

      // Emit ALL chunks in ONE emit call (single transaction)
      await act(async () => {
        controllers.chunks.emit(assistantRows)
        await flushPromises()
      })

      // Should have both messages
      await waitFor(() => {
        expect(result.current.messages.length).toBe(2)
      })

      // Final content should be complete
      const finalAssistant = result.current.messages.find(m => m.role === 'assistant')
      expect(getTextContent(finalAssistant!)).toBe(EXPECTED_CONTENT.ASSISTANT_1)
    })
  })

  describe('isLoading state', () => {
    it('should track isLoading based on active generations', async () => {
      const { result } = renderHook(() => useDurableChat({ client, autoConnect: false }))

      // Initially not loading
      expect(result.current.isLoading).toBe(false)

      // Emit user message
      await act(async () => {
        controllers.chunks.emit(getMessageRows(testData, TEST_MESSAGE_IDS.USER_1))
        await flushPromises()
      })

      // Still not loading (user messages don't create active generations)
      expect(result.current.isLoading).toBe(false)

      // Start assistant response (first chunk, not done)
      const assistantRows = getMessageRows(testData, TEST_MESSAGE_IDS.ASSISTANT_1)
      await act(async () => {
        controllers.chunks.emit([assistantRows[0]])
        await flushPromises()
      })

      // Should be loading now
      await waitFor(() => {
        expect(result.current.isLoading).toBe(true)
      })

      // Complete the message
      await act(async () => {
        controllers.chunks.emit(assistantRows.slice(1))
        await flushPromises()
      })

      // Should stop loading after done chunk
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
    })
  })

  describe('cleanup', () => {
    it('should clean up on unmount without error', async () => {
      const { unmount } = renderHook(() => useDurableChat({ client, autoConnect: false }))

      // Unmount should not throw
      expect(() => unmount()).not.toThrow()
    })
  })

  describe('client stability', () => {
    it('should maintain stable client reference across renders', async () => {
      const { result, rerender } = renderHook(() =>
        useDurableChat({ client, autoConnect: false })
      )

      const firstClient = result.current.client

      rerender()

      expect(result.current.client).toBe(firstClient)
    })

    it('should use the provided client instance', () => {
      const { result } = renderHook(() => useDurableChat({ client, autoConnect: false }))

      expect(result.current.client).toBe(client)
    })
  })
})
