import {
  HeadContent,
  Scripts,
  createRootRoute,
  useRouter,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { aiDevtoolsPlugin } from '@tanstack/react-ai-devtools'
import appCss from '../app.css?url'

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

export const Route = createRootRoute({
  notFoundComponent: NotFound,
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
        title: 'TanStack AI + Electric Durable Transport',
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
        <header className="border-b border-orange-500/20 bg-gray-900/80 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
            <h1 className="text-xl font-bold bg-linear-to-r from-orange-500 to-red-600 text-transparent bg-clip-text">
              TanStack AI + Electric Durable Transport
            </h1>
            <div className="text-gray-400 text-sm">
              Resilient, resumable AI streaming
            </div>
          </div>
        </header>
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
