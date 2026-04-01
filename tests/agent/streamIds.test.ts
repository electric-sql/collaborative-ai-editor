import { describe, expect, it } from 'vitest'
import {
  durableStreamResourceUrl,
  durableStreamsYjsBaseUrl,
} from '../../src/lib/yjs/streamIds'

describe('stream id URL helpers', () => {
  it('builds Yjs service URLs from a plain origin', () => {
    expect(durableStreamsYjsBaseUrl('https://api.electric-sql.cloud')).toBe(
      'https://api.electric-sql.cloud/v1/yjs/y-llm-demo-v2',
    )
  })

  it('passes through full Yjs service URLs unchanged', () => {
    expect(
      durableStreamsYjsBaseUrl(
        'https://api.electric-sql.cloud/v1/yjs/svc-yjs-amazing-bird-3nci0894vt',
      ),
    ).toBe('https://api.electric-sql.cloud/v1/yjs/svc-yjs-amazing-bird-3nci0894vt')
  })

  it('builds stream resource URLs from a plain origin', () => {
    expect(
      durableStreamResourceUrl('https://api.electric-sql.cloud', 'chats/doc-1/chat/default'),
    ).toBe('https://api.electric-sql.cloud/v1/stream/chats/doc-1/chat/default')
  })

  it('appends stream paths to full stream service URLs', () => {
    expect(
      durableStreamResourceUrl(
        'https://api.electric-sql.cloud/v1/stream/svc-symbolic-urial-k0drhgga4y',
        'chats/doc-1/chat/default',
      ),
    ).toBe(
      'https://api.electric-sql.cloud/v1/stream/svc-symbolic-urial-k0drhgga4y/chats/doc-1/chat/default',
    )
  })
})
