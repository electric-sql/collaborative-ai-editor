export type AgentRunMode = 'continue' | 'insert' | 'rewrite'

export type AgentAwarenessStatus = 'idle' | 'thinking' | 'composing'

export interface AgentTransactionOrigin {
  source: 'agent'
  sessionId: string
}
