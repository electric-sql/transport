import './globals.css'

export const metadata = {
  title: `Vercel AI SDK + Electric Durable Transport`,
  description: `Electric durable streams transport + Vercel AI SDK + Next.js + OpenAI streaming chat example.`,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
