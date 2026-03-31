import { createFileRoute } from '@tanstack/react-router'
import {
  durableStreamsYjsBaseUrl,
  getYjsDurableStreamsHeadersServer,
  getYjsDurableStreamsOriginServer,
} from '../../../lib/yjs/streamIds'

function upstreamYjsUrl(requestUrl: string, splat: string): string {
  const incoming = new URL(requestUrl)
  const upstream = new URL(
    `${durableStreamsYjsBaseUrl(getYjsDurableStreamsOriginServer())}/${splat.replace(/^\//, '')}`,
  )
  incoming.searchParams.forEach((value, key) => upstream.searchParams.set(key, value))
  return upstream.toString()
}

async function proxyYjsRequest(
  request: Request,
  splat: string,
): Promise<Response> {
  const upstreamUrl = upstreamYjsUrl(request.url, splat)
  const requestUrl = new URL(request.url)
  const upstreamHeaders = new Headers()
  const authHeaders = getYjsDurableStreamsHeadersServer()
  if (authHeaders) {
    for (const [key, value] of Object.entries(authHeaders)) {
      upstreamHeaders.set(key, value)
    }
  }
  const accept = request.headers.get('accept')
  const contentType = request.headers.get('content-type')
  if (accept) upstreamHeaders.set('accept', accept)
  if (contentType) upstreamHeaders.set('content-type', contentType)

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  const upstreamResponse = await fetch(upstreamUrl, {
    method: request.method,
    headers: upstreamHeaders,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: 'manual',
  })

  const responseHeaders = new Headers(upstreamResponse.headers)
  const location = responseHeaders.get('location')
  if (location) {
    const upstreamBase = `${durableStreamsYjsBaseUrl(getYjsDurableStreamsOriginServer())}/`
    const absoluteLocation = new URL(location, upstreamUrl).toString()
    if (absoluteLocation.startsWith(upstreamBase)) {
      const suffix = absoluteLocation.slice(upstreamBase.length)
      responseHeaders.set(
        'location',
        `${requestUrl.origin}/api/yjs/${suffix}`,
      )
    }
  }
  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  })
}

export const Route = createFileRoute('/api/yjs/$')({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: { _splat: string } }) =>
        proxyYjsRequest(request, params._splat),
      PUT: async ({ request, params }: { request: Request; params: { _splat: string } }) =>
        proxyYjsRequest(request, params._splat),
      POST: async ({ request, params }: { request: Request; params: { _splat: string } }) =>
        proxyYjsRequest(request, params._splat),
    },
  },
} as never)
