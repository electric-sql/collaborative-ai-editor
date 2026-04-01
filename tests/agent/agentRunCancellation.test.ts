import { afterEach, describe, expect, it } from 'vitest'
import {
  abortAgentRun,
  attachAgentRunController,
  releaseAgentRunAbort,
} from '../../src/lib/agent/agentRunCancellation'

describe('agentRunCancellation', () => {
  afterEach(() => {
    abortAgentRun('doc-release-race', 'main')
    abortAgentRun('doc-a', 'main')
    abortAgentRun('doc-b', 'main')
  })

  it('does not release a newer run when an older run finishes later', () => {
    const first = attachAgentRunController('doc-release-race', 'main')
    const second = attachAgentRunController('doc-release-race', 'main')

    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(false)

    releaseAgentRunAbort('doc-release-race', 'main', first)

    expect(abortAgentRun('doc-release-race', 'main')).toBe(true)
    expect(second.signal.aborted).toBe(true)
  })

  it('isolates runs by document key even when session ids match', () => {
    const docARun = attachAgentRunController('doc-a', 'main')
    const docBRun = attachAgentRunController('doc-b', 'main')

    expect(abortAgentRun('doc-a', 'main')).toBe(true)
    expect(docARun.signal.aborted).toBe(true)
    expect(docBRun.signal.aborted).toBe(false)

    expect(abortAgentRun('doc-b', 'main')).toBe(true)
    expect(docBRun.signal.aborted).toBe(true)
  })
})
