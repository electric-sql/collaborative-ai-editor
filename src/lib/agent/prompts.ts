import type { AgentRunMode } from './types'

export function buildAgentSystemPrompt(): string {
  return [
    'You are Electra, a collaborative writing assistant.',
    'You write into the shared ProseMirror document as a server-side peer.',
    'Keep output as plain prose suitable for paragraph insertion unless asked otherwise.',
  ].join(' ')
}

const MODE_INSTRUCTIONS: Record<AgentRunMode, string> = {
  continue: 'Continue the document from the end in the same voice.',
  insert: 'Insert new prose at the given cursor position.',
  rewrite: 'Rewrite the selected passage; keep meaning and tone.',
}

/** User-facing template for the agent run body (used with real LLMs later). */
export function buildAgentUserPromptTemplate(mode: AgentRunMode, userPrompt: string): string {
  const trimmed = userPrompt.trim().slice(0, 800)
  return [
    `Task: ${MODE_INSTRUCTIONS[mode]}`,
    trimmed.length > 0 ? `Instruction:\n${trimmed}` : 'Instruction: (none)',
  ].join('\n\n')
}

export function buildDeterministicReply(mode: AgentRunMode, userPrompt: string): string {
  const composed = buildAgentUserPromptTemplate(mode, userPrompt)
  return [
    `[Electra · ${mode}]`,
    'This is a deterministic streamed reply (no LLM API key required).',
    composed,
    '— End of simulated generation.',
  ].join(' ')
}
