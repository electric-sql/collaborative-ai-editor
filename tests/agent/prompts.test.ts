import { describe, expect, it } from 'vitest'
import {
  buildAgentSystemPrompt,
  buildAgentUserPromptTemplate,
  buildChatToolSystemPrompt,
  buildDeterministicReply,
} from '../../src/lib/agent/prompts'

describe('prompt unit tests', () => {
  it('builds the base agent system prompt', () => {
    const prompt = buildAgentSystemPrompt()

    expect(prompt).toContain('Electra')
    expect(prompt).toContain('shared ProseMirror document')
    expect(prompt).toContain('plain prose suitable for paragraph insertion')
  })

  it('builds chat tool prompts for default and preferred modes', () => {
    const defaultPrompt = buildChatToolSystemPrompt()
    const insertPrompt = buildChatToolSystemPrompt('insert')
    const rewritePrompt = buildChatToolSystemPrompt('rewrite')

    expect(defaultPrompt).toContain('must perform that work in the document with tools')
    expect(defaultPrompt).toContain('write me a short story')
    expect(defaultPrompt).toContain('Only call start_streaming_edit')
    expect(insertPrompt).toContain('prefer insert mode')
    expect(rewritePrompt).toContain('prefer rewrite mode')
  })

  it('builds user prompt templates for each mode', () => {
    expect(buildAgentUserPromptTemplate('continue', 'Keep going')).toContain(
      'Task: Continue the document from the end in the same voice.',
    )
    expect(buildAgentUserPromptTemplate('insert', 'Add a paragraph')).toContain(
      'Task: Insert new prose at the given cursor position.',
    )
    expect(buildAgentUserPromptTemplate('rewrite', 'Make it shorter')).toContain(
      'Task: Rewrite the selected passage; keep meaning and tone.',
    )
  })

  it('trims overly long user prompts and handles empty input', () => {
    const long = `  ${'x'.repeat(900)}  `
    const trimmed = buildAgentUserPromptTemplate('continue', long)
    const empty = buildAgentUserPromptTemplate('continue', '   ')

    expect(trimmed).toContain(`Instruction:\n${'x'.repeat(800)}`)
    expect(trimmed).not.toContain('  ')
    expect(empty).toContain('Instruction: (none)')
  })

  it('builds a deterministic reply for each mode', () => {
    const reply = buildDeterministicReply('rewrite', 'Polish this paragraph')

    expect(reply).toContain('[Electra · rewrite]')
    expect(reply).toContain('deterministic streamed reply')
    expect(reply).toContain('Polish this paragraph')
  })
})
