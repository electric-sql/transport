/**
 * PresenceBar - Shows agents and online users in the session.
 */

import { useLiveQuery } from '@tanstack/react-db'
import { eq } from '@tanstack/db'
import { AVAILABLE_AGENTS } from '../lib/agents'
import type { AgentSpec, DurableChatCollections, PresenceRow } from '@electric-sql/react-ai-db'

interface PresenceBarProps {
  collections: DurableChatCollections
  registerAgents: (agents: AgentSpec[]) => Promise<void>
  unregisterAgent: (agentId: string) => Promise<void>
}

export function PresenceBar({
  collections,
  registerAgents,
  unregisterAgent,
}: PresenceBarProps) {
  // Get registered agents
  const registeredAgents = useLiveQuery(
    (q) => q.from({ agent: collections.agents }),
    [collections.agents]
  )

  // Get online users
  const onlineUsers = useLiveQuery(
    (q) =>
      q
        .from({ presence: collections.presence })
        .where(({ presence }) => eq(presence.actorType, 'user'))
        .where(({ presence }) => eq(presence.status, 'online')),
    [collections.presence]
  )

  const registeredAgentIds = new Set(
    registeredAgents.data?.map((a) => a.agentId) ?? []
  )

  const handleToggleAgent = async (agent: typeof AVAILABLE_AGENTS[number]) => {
    if (registeredAgentIds.has(agent.id)) {
      await unregisterAgent(agent.id)
    } else {
      await registerAgents([agent])
    }
  }

  return (
    <div className="flex items-center gap-4 px-4 py-2 border-b border-gray-800 bg-gray-900/30">
      {/* Agents section */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">Agents:</span>
        {AVAILABLE_AGENTS.map((agent) => (
          <AgentChip
            key={agent.id}
            agent={agent}
            isRegistered={registeredAgentIds.has(agent.id)}
            onToggle={() => handleToggleAgent(agent)}
          />
        ))}
      </div>

      {/* Users section */}
      <div className="flex items-center gap-2 ml-auto">
        <span className="text-sm text-gray-500">Users:</span>
        {onlineUsers.data?.map((user) => (
          <UserChip key={user.actorId} user={user} />
        ))}
        {(!onlineUsers.data || onlineUsers.data.length === 0) && (
          <span className="text-xs text-gray-600">No users online</span>
        )}
      </div>
    </div>
  )
}

interface AgentChipProps {
  agent: typeof AVAILABLE_AGENTS[number]
  isRegistered: boolean
  onToggle: () => void
}

function AgentChip({ agent, isRegistered, onToggle }: AgentChipProps) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
        isRegistered
          ? 'bg-green-500/20 text-green-400 border border-green-500/30'
          : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600'
      }`}
    >
      <img
        src={`/img/${agent.id}.jpg`}
        alt={agent.name}
        className="w-4 h-4 rounded-full object-cover"
        onError={(e) => {
          // Fallback to emoji if image fails to load
          (e.target as HTMLImageElement).style.display = 'none'
        }}
      />
      {agent.name}
      <span className="ml-0.5">{isRegistered ? '✓' : '+'}</span>
    </button>
  )
}

interface UserChipProps {
  user: PresenceRow
}

function UserChip({ user }: UserChipProps) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300">
      <img
        src={`https://github.com/${user.actorId}.png`}
        alt={user.name ?? user.actorId}
        className="w-4 h-4 rounded-full"
        onError={(e) => {
          // Fallback to initials
          (e.target as HTMLImageElement).style.display = 'none'
        }}
      />
      {user.name ?? user.actorId}
    </div>
  )
}
