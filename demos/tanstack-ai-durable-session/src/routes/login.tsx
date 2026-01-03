import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

function LoginPage() {
  const navigate = useNavigate()
  const [sessionId, setSessionId] = useState('default')
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!sessionId.trim()) {
      setError('Session ID is required')
      return
    }

    if (!username.trim()) {
      setError('GitHub username is required')
      return
    }

    // Navigate to chat - the loader will call the login API
    navigate({
      to: '/chat/$sessionId/$username',
      params: {
        sessionId: sessionId.trim(),
        username: username.trim()
      },
    })
  }

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-73px)]">
      <div className="w-full max-w-md p-8 bg-gray-800 rounded-lg border border-gray-700">
        <h2 className="text-2xl font-bold text-white mb-6 text-center">
          Join Chat Session
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="sessionId" className="block text-sm text-gray-400 mb-1">
              Session ID
            </label>
            <input
              id="sessionId"
              type="text"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              placeholder="default"
              required
            />
            <p className="mt-1 text-xs text-gray-500">
              Use the same session ID to join an existing conversation
            </p>
          </div>

          <div>
            <label htmlFor="username" className="block text-sm text-gray-400 mb-1">
              GitHub Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              placeholder="your-github-username"
              required
            />
            <p className="mt-1 text-xs text-gray-500">
              Your GitHub avatar will be used for display
            </p>
          </div>

          {error && (
            <div className="p-3 bg-red-900/20 border border-red-700/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="w-full py-3 bg-linear-to-r from-orange-500 to-red-600 text-white font-medium rounded-lg hover:from-orange-600 hover:to-red-700 transition-all"
          >
            Join Session
          </button>
        </form>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/login')({
  component: LoginPage,
})
