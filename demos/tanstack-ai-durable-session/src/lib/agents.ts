/**
 * Agent configuration for the demo.
 */

import type { AgentSpec } from '@electric-sql/react-ai-db'
import { appUrl } from './config'

export const KERMIT_AGENT: AgentSpec = {
  id: 'kermit',
  name: 'Kermit',
  endpoint: `${appUrl}/api/chat/kermit`,
  method: 'POST',
  triggers: 'user-messages',
}

export const OSCAR_AGENT: AgentSpec = {
  id: 'oscar',
  name: 'Oscar',
  endpoint: `${appUrl}/api/chat/oscar`,
  method: 'POST',
  triggers: 'user-messages',
}

export const AVAILABLE_AGENTS = [KERMIT_AGENT, OSCAR_AGENT] as const
