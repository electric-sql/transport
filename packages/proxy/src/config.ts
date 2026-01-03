export const durableStreamsUrl =
  process.env.DURABLE_STREAMS_URL || `http://localhost:3001`

export const proxyPort = process.env.PROXY_PORT || 4000
export const proxyUrl = process.env.PROXY_URL || `http://localhost:${proxyPort}`
