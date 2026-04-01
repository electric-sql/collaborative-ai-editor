import { describe, expect, it } from 'vitest'
import {
  buildAgentSystemPrompt,
  buildAgentUserPromptTemplate,
  buildChatToolSystemPrompt,
  buildDeterministicReply,
  buildPostEditSummaryPrompt,
  buildPostEditSummarySystemPrompt,
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
    expect(defaultPrompt).toContain('follow up with one short chat sentence describing what you actually changed')
    expect(defaultPrompt).toContain('If a tool call did not change the document, do not claim that it did')
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

  it('builds a post-edit summary prompt from actual mutations', () => {
    const systemPrompt = buildPostEditSummarySystemPrompt()
    const userPrompt = buildPostEditSummaryPrompt({
      userRequest: 'Add a short story at the end.',
      mutations: [
        { kind: 'streaming_edit', mode: 'continue', contentFormat: 'plain_text', committedChars: 84 },
      ],
    })

    expect(systemPrompt).toContain('Do not make any more document changes')
    expect(userPrompt).toContain('User request: Add a short story at the end.')
    expect(userPrompt).toContain('completed a continue streaming edit in plain_text (84 chars)')
  })
})
