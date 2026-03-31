import { YjsProvider } from '@durable-streams/y-durable-streams'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import {
  appYjsProxyBaseUrl,
  docCollaborationDocId,
} from './streamIds'

/** Shared `Y.XmlFragment` name for the ProseMirror document. */
export const Y_XML_FRAGMENT_KEY = 'prosemirror'

export interface CreateRoomProviderOptions {
  docKey: string
  localUserName: string
  localUserColor: string
}

export function createRoomProvider(options: CreateRoomProviderOptions): {
  ydoc: Y.Doc
  awareness: Awareness
  provider: YjsProvider
  fragment: Y.XmlFragment
} {
  const ydoc = new Y.Doc()
  const awareness = new Awareness(ydoc)
  awareness.setLocalState({
    user: {
      name: options.localUserName,
      color: options.localUserColor,
    },
  })

  const baseUrl = appYjsProxyBaseUrl()
  const docId = docCollaborationDocId(options.docKey)

  const provider = new YjsProvider({
    doc: ydoc,
    baseUrl,
    docId,
    awareness,
    connect: false,
  })

  const providerDebug = provider as any
  const previewBytes = (data: Uint8Array) =>
    Array.from(data.slice(0, 24))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join(' ')
  const textDecoder = new TextDecoder()
  const isBase64Byte = (value: number) =>
    (value >= 0x41 && value <= 0x5a) ||
    (value >= 0x61 && value <= 0x7a) ||
    (value >= 0x30 && value <= 0x39) ||
    value === 0x2b ||
    value === 0x2f ||
    value === 0x3d ||
    value === 0x0a ||
    value === 0x0d
  const providerHeaders = providerDebug.headers as Record<string, string> | undefined
  const providerDocUrl = `${baseUrl}/docs/${docId}`
  if (typeof providerDebug.docUrl === 'function') {
    providerDebug.docUrl = () => providerDocUrl
  }
  if (typeof providerDebug.awarenessUrl === 'function') {
    providerDebug.awarenessUrl = (name: string = 'default') =>
      `${providerDocUrl}?awareness=${encodeURIComponent(name)}`
  }

  if (typeof providerDebug.discoverSnapshot === 'function') {
    providerDebug.discoverSnapshot = async (ctx: {
      controller: AbortController
      startOffset: string
    }) => {
      const url = `${providerDocUrl}?offset=snapshot`
      const response = await fetch(url, {
        method: 'GET',
        headers: providerHeaders,
        redirect: 'manual',
        signal: ctx.controller.signal,
      })
      const location = response.headers.get('location')
      const finalUrl = location ? new URL(location, url).toString() : response.url || url
      const resolvedOffset = new URL(finalUrl).searchParams.get('offset')
      await response.body?.cancel().catch(() => {})

      if (resolvedOffset) {
        if (resolvedOffset.endsWith('_snapshot')) {
          await providerDebug.loadSnapshot?.(ctx, resolvedOffset)
        } else {
          ctx.startOffset = resolvedOffset
        }
        return
      }

      ctx.startOffset = '-1'
    }
  }

  if (providerDebug.applyUpdates) {
    const originalApplyUpdates = providerDebug.applyUpdates.bind(provider)
    providerDebug.applyUpdates = (data: Uint8Array) => {
      let decodedData = data
      const looksLikeBase64 =
        data.length > 0 &&
        data.length % 4 === 0 &&
        Array.from(data.slice(0, Math.min(64, data.length))).every(isBase64Byte)
      if (looksLikeBase64) {
        try {
          const base64 = textDecoder.decode(data).replace(/[\r\n]/g, '')
          if (base64.length > 0 && base64.length % 4 === 0) {
            const binary = atob(base64)
            decodedData = Uint8Array.from(binary, (char) => char.charCodeAt(0))
          }
        } catch {
          decodedData = data
        }
      }
      try {
        originalApplyUpdates(decodedData)
      } catch (error) {
        console.error('[yjs-provider] failed to apply updates', {
          docId,
          bytes: decodedData.length,
          preview: previewBytes(decodedData),
          error,
        })
        throw error
      }
    }
  }

  provider.on('error', (err) => {
    console.error('[yjs-provider] error', err)
  })
  let reconnecting = false
  const reconnectInterval = setInterval(() => {
    // If initial handshake stalls in `connecting`, perform a clean reconnect.
    if (!provider.connected && provider.connecting && !reconnecting) {
      reconnecting = true
      provider
        .disconnect()
        .catch(() => {})
        .finally(() => provider.connect().catch(() => {}))
        .finally(() => {
          reconnecting = false
        })
    }
  }, 8000)

  const originalDestroy = provider.destroy.bind(provider)
  provider.destroy = () => {
    clearInterval(reconnectInterval)
    originalDestroy()
  }

  void provider.connect()

  const fragment = ydoc.getXmlFragment(Y_XML_FRAGMENT_KEY)

  return { ydoc, awareness, provider, fragment }
}

/** Re-export for routes that need the same stream topology (e.g. chat in milestone 3). */
export { chatSessionStreamPath, docPresenceAwarenessName } from './streamIds'
