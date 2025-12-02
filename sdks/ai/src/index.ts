import {
  DefaultChatTransport,
  type HttpChatTransportInitOptions,
  type PrepareReconnectToStreamRequest,
  type PrepareSendMessagesRequest,
  type UIMessage
} from 'ai'

import {
  createFetchClient,
  type FetchClientOptions
} from '@electric-sql/transport'

export function durableTransport<UI_MESSAGE extends UIMessage = UIMessage>(
  fetchOptions: FetchClientOptions,
  transportOptions: HttpChatTransportInitOptions<UI_MESSAGE>
): DefaultChatTransport<UI_MESSAGE> {
  const fetch = createFetchClient(fetchOptions)

  const prepareReconnectToStreamRequest: PrepareReconnectToStreamRequest = (opts) => {
    const headers = opts.headers instanceof Headers ? opts.headers : new Headers(opts.headers)
    headers.set('X-Session-ID', opts.id)
    headers.set('X-Resume-Active-Generation', 'true')
    opts.headers = headers

    const original = transportOptions.prepareReconnectToStreamRequest
    return original !== undefined ? original(opts) : opts
  }

  const prepareSendMessagesRequest: PrepareSendMessagesRequest<UI_MESSAGE> = (opts) => {
    const headers = opts.headers instanceof Headers ? opts.headers : new Headers(opts.headers)
    headers.set('X-Session-ID', opts.id)

    const prepared = { ...opts, headers, body: opts.body ?? {} }

    const original = transportOptions.prepareSendMessagesRequest
    return original !== undefined ? original(prepared) : prepared
  }

  return new DefaultChatTransport({
    ...transportOptions,
    fetch,
    prepareReconnectToStreamRequest,
    prepareSendMessagesRequest
  })
}
