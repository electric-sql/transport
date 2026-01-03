import {
  HeadContent,
  Scripts,
  createRootRoute,
  useRouter,
  useNavigate,
  useMatch,
  Outlet,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { aiDevtoolsPlugin } from '@tanstack/react-ai-devtools'
import { LogOut } from 'lucide-react'
import appCss from '../app.css?url'
import { proxyUrl } from '../lib/config'

function NotFound() {
  const router = useRouter()
  const path = router.state.location.pathname

  // Ignore browser/extension probes
  if (path.startsWith('/.well-known/')) {
    return null
  }

  return (
    <div className="p-8 text-white">
      <h1 className="text-2xl font-bold text-red-500">404 - Not Found</h1>
      <p className="mt-2 text-gray-400">Path: {path}</p>
    </div>
  )
}

function RootLayout() {
  const navigate = useNavigate()

  // Try to match the chat route to get session info from URL params
  const chatMatch = useMatch({
    from: '/chat/$sessionId/$username',
    shouldThrow: false,
  })

  // Get session from URL params if on chat route
  const session = chatMatch
    ? { sessionId: chatMatch.params.sessionId, username: chatMatch.params.username }
    : null

  const handleLogout = async () => {
    if (session) {
      try {
        // Explicit logout logs out ALL devices for this user
        await fetch(`${proxyUrl}/v1/sessions/${session.sessionId}/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actorId: session.username, allDevices: true }),
        })
      } catch (error) {
        console.error('Logout error:', error)
      }
      // Clear deviceId from sessionStorage
      sessionStorage.removeItem('deviceId')
      navigate({ to: '/login' })
    }
  }

  return (
    <>
      <header className="border-b border-orange-500/20 bg-gray-900/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold bg-linear-to-r from-orange-500 to-red-600 text-transparent bg-clip-text">
            TanStack AI - DB - Durable Sessions
          </h1>
          <div className="flex items-center gap-4">
            <div className="text-gray-400 text-sm">
              Persistent, resumable, multi-user, multi-agent, AI chat
            </div>
            {session && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <img
                    src={`https://github.com/${session.username}.png`}
                    alt={session.username}
                    className="w-6 h-6 rounded-full"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                  <span className="text-sm text-gray-300">{session.username}</span>
                </div>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                >
                  <LogOut className="w-3 h-3" />
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <Outlet />
    </>
  )
}

export const Route = createRootRoute({
  notFoundComponent: NotFound,
  component: RootLayout,
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'TanStack AI + Durable Sessions',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),

  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-gray-900">
        {children}
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
            aiDevtoolsPlugin(),
          ]}
          eventBusConfig={{
            connectToServerBus: true,
          }}
        />
        <Scripts />
      </body>
    </html>
  )
}
