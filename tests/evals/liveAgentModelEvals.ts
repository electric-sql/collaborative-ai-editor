import { chat, maxIterations } from '@tanstack/ai'
import { openaiText } from '@tanstack/ai-openai'
import { buildChatToolSystemPrompt } from '../../src/lib/agent/prompts'
import { createDocumentTools } from '../../src/lib/agent/documentTools'
import { DocumentToolRuntime } from '../../src/lib/agent/documentToolRuntime'
import { routeAgentStreamChunks } from '../../src/lib/agent/chatStreamRouting'
import { createTestSession, readDocJson, readDocText } from '../agent/testUtils'

type EvalResult = {
  name: string
  passed: boolean
  initialDocText: string
  docText: string
  docJson: unknown
  chatText: string
  toolCalls: string[]
  details?: string
}

type Scenario = {
  name: string
  preferredMode: 'continue' | 'insert' | 'rewrite'
  seed?: string
  prompt: string
  validate: (result: EvalResult) => string | null
}

const SUMMARY_LEAK_PATTERNS = [
  /\bI added\b/i,
  /\bI inserted\b/i,
  /\bI rewrote\b/i,
  /\bI replaced\b/i,
  /\bI deleted\b/i,
  /\bI have\b/i,
  /\bLet me know\b/i,
  /\bI need to locate\b/i,
]

function validateNoSummaryLeakInDocument(result: EvalResult): string | null {
  for (const pattern of SUMMARY_LEAK_PATTERNS) {
    if (pattern.test(result.docText)) {
      return `Document leaked assistant summary text matching ${pattern}.`
    }
  }
  return null
}

function chainValidators(
  ...validators: Array<(result: EvalResult) => string | null>
): (result: EvalResult) => string | null {
  return (result) => {
    for (const validate of validators) {
      const failure = validate(result)
      if (failure) return failure
    }
    return null
  }
}

function validateRequiredChatSummary(result: EvalResult): string | null {
  if (result.docText !== result.initialDocText && result.chatText.trim().length === 0) {
    return 'Expected a short chat summary after the document edit, but chat text was empty.'
  }
  return null
}

async function runScenario(scenario: Scenario): Promise<EvalResult> {
  const session = createTestSession(`eval-${scenario.name.replace(/\s+/g, '-').toLowerCase()}`)
  const runtime = DocumentToolRuntime.createForSession({ session })

  try {
    if (scenario.seed) {
      runtime.insertText(scenario.seed)
    }
    const initialDocText = readDocText(session)

    const stream = chat({
      adapter: openaiText((process.env.OPENAI_MODEL?.trim() || 'gpt-5.4') as any),
      messages: [{ role: 'user', content: scenario.prompt }] as any,
      systemPrompts: [buildChatToolSystemPrompt(scenario.preferredMode)],
      tools: createDocumentTools(runtime),
      agentLoopStrategy: maxIterations(10),
      temperature: 0,
    })

    const toolCalls: string[] = []
    let chatText = ''

    for await (const chunk of routeAgentStreamChunks(stream, runtime)) {
      if (chunk.type === 'TOOL_CALL_START') {
        toolCalls.push(chunk.toolName)
      }
      if (chunk.type === 'TEXT_MESSAGE_CONTENT') {
        chatText += chunk.delta
      }
    }

    if (runtime.isStreamingEditActive()) {
      runtime.stopStreamingEdit(false)
    }

    const docText = readDocText(session)
    const docJson = readDocJson(session)
    const resultForValidation = {
      name: scenario.name,
      passed: true,
      initialDocText,
      docText,
      docJson,
      chatText,
      toolCalls,
    }
    const details =
      scenario.validate(resultForValidation) ?? validateRequiredChatSummary(resultForValidation) ?? undefined

    return {
      name: scenario.name,
      passed: !details,
      initialDocText,
      docText,
      docJson,
      chatText,
      toolCalls,
      details,
    }
  } finally {
    runtime.destroy()
  }
}

const scenarios: Scenario[] = [
  {
    name: 'short story goes to document',
    preferredMode: 'continue',
    prompt:
      'Write exactly two sentences of a short story about a lighthouse keeper. Put the story in the document, not the chat.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (!result.toolCalls.includes('start_streaming_edit')) {
        return 'Expected start_streaming_edit to be called.'
      }
      if (result.docText.length < 60) {
        return `Expected substantial document output, got ${result.docText.length} chars.`
      }
      if ((result.docText.match(/[.!?]/g) ?? []).length < 2) {
        return 'Expected at least two sentence-ending punctuation marks in the document.'
      }
      return null
    }),
  },
  {
    name: 'continue scene in tense quiet tone',
    preferredMode: 'continue',
    seed: 'Night settled over the harbor.',
    prompt:
      'Continue this scene in a tense, quiet tone with exactly one additional sentence. Put the prose in the document.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (!result.docText.startsWith('Night settled over the harbor.')) {
        return 'Expected the original scene opener to remain at the start.'
      }
      if (result.docText.length <= 'Night settled over the harbor.'.length + 10) {
        return 'Expected a meaningful continuation sentence.'
      }
      return null
    }),
  },
  {
    name: 'draft introduction about ai safety',
    preferredMode: 'continue',
    prompt:
      'Draft a short introduction about AI safety for the document. Mention AI safety explicitly and keep it to two sentences.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (!/AI safety/i.test(result.docText)) {
        return 'Expected the drafted introduction to mention AI safety.'
      }
      if ((result.docText.match(/[.!?]/g) ?? []).length < 2) {
        return 'Expected a two-sentence introduction.'
      }
      return null
    }),
  },
  {
    name: 'two line poem goes to document',
    preferredMode: 'continue',
    prompt:
      'Write a very short two-line poem about fog and dawn. Put the poem in the document, not the chat.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (result.docText.length < 20) {
        return 'Expected a non-trivial poem in the document.'
      }
      if (!result.docText.includes('\n') && !result.docText.includes('\n\n')) {
        return 'Expected the poem to have at least two lines.'
      }
      return null
    }),
  },
  {
    name: 'hopeful ending continues article',
    preferredMode: 'continue',
    seed: 'The town had survived the winter, but nobody knew what would come next.',
    prompt:
      'Finish this article with a hopeful ending in the document. Add one short paragraph and do not explain what you did.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (!result.docText.startsWith('The town had survived the winter')) {
        return 'Expected the original article opening to remain.'
      }
      if (result.docText.length < 100) {
        return 'Expected a meaningful hopeful ending to be appended.'
      }
      return null
    }),
  },
  {
    name: 'rewrite bad to good',
    preferredMode: 'rewrite',
    seed: 'One bad sentence. Another line.',
    prompt:
      'Rewrite the sentence containing the word bad so it uses the word good instead. Keep the rest of the document unchanged.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (!result.docText.includes('good')) {
        return 'Expected rewritten document to contain "good".'
      }
      if (result.docText.includes('bad')) {
        return 'Expected rewritten document to remove "bad".'
      }
      if (!result.docText.endsWith('Another line.')) {
        return 'Expected trailing document text to remain unchanged.'
      }
      return null
    }),
  },
  {
    name: 'rewrite winding sentence to exact shorter version',
    preferredMode: 'rewrite',
    seed: 'This sentence is long and winding. Another line.',
    prompt:
      'Rewrite the sentence containing the word winding to exactly "This sentence is brief." and leave the rest of the document unchanged.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (!result.docText.startsWith('This sentence is brief.')) {
        return 'Expected the rewritten document to start with the exact shorter sentence.'
      }
      if (!result.docText.endsWith('Another line.')) {
        return 'Expected the trailing sentence to remain unchanged.'
      }
      if (/winding/.test(result.docText)) {
        return 'Expected the word winding to be removed.'
      }
      return null
    }),
  },
  {
    name: 'rewrite note to formal tone',
    preferredMode: 'rewrite',
    seed: 'this note is kinda messy and casual.',
    prompt:
      'Rewrite the note in a more formal tone. Keep it to one sentence and put the result in the document.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (result.docText === 'this note is kinda messy and casual.') {
        return 'Expected the note to change.'
      }
      if ((result.docText.match(/[.!?]/g) ?? []).length < 1) {
        return 'Expected the rewritten note to remain a sentence.'
      }
      return null
    }),
  },
  {
    name: 'rewrite selected paragraph shorter',
    preferredMode: 'rewrite',
    seed: 'The report explains the process in a slow and repetitive way. The final note should stay.',
    prompt:
      'Rewrite the first sentence so it is shorter and clearer, but leave the final note untouched.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (!result.docText.endsWith('The final note should stay.')) {
        return 'Expected the final note to remain untouched.'
      }
      if (result.docText.includes('slow and repetitive')) {
        return 'Expected the first sentence to be rewritten away from the original wording.'
      }
      return null
    }),
  },
  {
    name: 'write markdown outline with heading and bullets',
    preferredMode: 'continue',
    prompt:
      'Write a markdown outline for a release plan with one heading and exactly three bullet points. Use start_streaming_edit with contentFormat markdown and stream the markdown into the document.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (!result.toolCalls.includes('start_streaming_edit')) {
        return 'Expected start_streaming_edit for markdown outline generation.'
      }
      const json = result.docJson as any
      if (json?.content?.[0]?.type !== 'heading') {
        return 'Expected the markdown outline to begin with a heading node.'
      }
      const listNode = json?.content?.find?.((node: any) => node.type === 'bullet_list')
      if (!listNode || listNode.content?.length !== 3) {
        return 'Expected exactly three bullet list items.'
      }
      return null
    }),
  },
  {
    name: 'write markdown heading and paragraph at top',
    preferredMode: 'continue',
    prompt:
      'Write markdown with a level-2 heading titled "Launch Notes" followed by a short paragraph. Use start_streaming_edit with contentFormat markdown and put the markdown result in the document.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      const json = result.docJson as any
      if (json?.content?.[0]?.type !== 'heading' || json?.content?.[0]?.attrs?.level !== 2) {
        return 'Expected a level-2 heading at the top of the document.'
      }
      if (json?.content?.[1]?.type !== 'paragraph') {
        return 'Expected a paragraph after the heading.'
      }
      return null
    }),
  },
  {
    name: 'rewrite with markdown emphasis',
    preferredMode: 'rewrite',
    seed: 'This line should be emphasized.',
    prompt:
      'Rewrite the sentence so the key word is bold using markdown. Use start_streaming_edit with contentFormat markdown and put the formatted result in the document.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      const json = result.docJson as any
      const marks = json?.content?.[0]?.content?.flatMap?.((node: any) => node.marks ?? []) ?? []
      if (!marks.some((mark: any) => mark.type === 'strong')) {
        return 'Expected the rewritten markdown result to contain a strong mark.'
      }
      return null
    }),
  },
  {
    name: 'delete beta only',
    preferredMode: 'rewrite',
    seed: 'alpha beta gamma',
    prompt: 'Delete the word beta from the document and do not change anything else.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (result.docText.includes('beta')) {
        return 'Expected beta to be removed from the document.'
      }
      if (!result.docText.includes('alpha') || !result.docText.includes('gamma')) {
        return 'Expected surrounding text to remain present.'
      }
      return null
    }),
  },
  {
    name: 'delete middle sentence only',
    preferredMode: 'rewrite',
    seed: 'First sentence. Remove me please. Final sentence.',
    prompt: 'Delete only the middle sentence "Remove me please." and keep the other two sentences unchanged.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (result.docText.includes('Remove me please.')) {
        return 'Expected the middle sentence to be removed.'
      }
      if (!result.docText.startsWith('First sentence.') || !result.docText.endsWith('Final sentence.')) {
        return 'Expected the first and final sentences to remain.'
      }
      return null
    }),
  },
  {
    name: 'make beta bold',
    preferredMode: 'rewrite',
    seed: 'alpha beta gamma',
    prompt:
      'Select the word beta and make it bold. Do not change any other text.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (!result.toolCalls.includes('set_format')) {
        return 'Expected set_format to be used for bold formatting.'
      }
      const json = result.docJson as any
      const marks =
        json?.content?.[0]?.content?.find?.((node: any) => node.text === 'beta')?.marks ?? []
      if (!marks.some((mark: any) => mark.type === 'strong')) {
        return 'Expected beta to have a strong mark.'
      }
      return null
    }),
  },
  {
    name: 'make beta italic',
    preferredMode: 'rewrite',
    seed: 'alpha beta gamma',
    prompt:
      'Apply italic formatting to the word beta without changing any surrounding text.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (!result.toolCalls.includes('set_format')) {
        return 'Expected set_format to be used for italic formatting.'
      }
      const json = result.docJson as any
      const marks =
        json?.content?.[0]?.content?.find?.((node: any) => node.text === 'beta')?.marks ?? []
      if (!marks.some((mark: any) => mark.type === 'em')) {
        return 'Expected beta to have an italic mark.'
      }
      return null
    }),
  },
  {
    name: 'turn line into heading',
    preferredMode: 'rewrite',
    seed: 'Section title',
    prompt:
      'Format the entire line as a heading, keeping the text exactly the same.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (!result.toolCalls.includes('set_format')) {
        return 'Expected set_format to be used for heading formatting.'
      }
      const json = result.docJson as any
      if (json?.content?.[0]?.type !== 'heading') {
        return 'Expected the first block to be a heading node.'
      }
      return null
    }),
  },
  {
    name: 'turn line into bullet list',
    preferredMode: 'rewrite',
    seed: 'List item',
    prompt:
      'Turn the current line into a bullet list item without changing the text.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (!result.toolCalls.includes('set_format')) {
        return 'Expected set_format to be used for bullet list formatting.'
      }
      const json = result.docJson as any
      if (json?.content?.[0]?.type !== 'bullet_list') {
        return 'Expected the first block to be a bullet_list node.'
      }
      return null
    }),
  },
  {
    name: 'add note before beta',
    preferredMode: 'insert',
    seed: 'alpha beta gamma',
    prompt: 'Add the exact note "[note] " immediately before the word beta.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (!result.docText.includes('[note] beta')) {
        return 'Expected the exact note to appear immediately before beta.'
      }
      if (!result.docText.startsWith('alpha ')) {
        return 'Expected content before beta to remain in place.'
      }
      return null
    }),
  },
  {
    name: 'insert exact sentence after beta',
    preferredMode: 'insert',
    seed: 'alpha beta gamma',
    prompt:
      'Insert the exact sentence "After beta comes a bridge." immediately after the word beta.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (!result.docText.includes('After beta comes a bridge.')) {
        return 'Expected the exact requested sentence to appear in the document.'
      }
      if (!result.docText.startsWith('alpha beta')) {
        return 'Expected the insert to happen after the beta position, not before the document start.'
      }
      return null
    }),
  },
  {
    name: 'insert short callout after sentence',
    preferredMode: 'insert',
    seed: 'The beta section needs emphasis. Another sentence follows.',
    prompt:
      'Insert the exact callout "(Important.)" immediately after the sentence "The beta section needs emphasis." with no extra spaces before or after the callout.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (!result.docText.includes('The beta section needs emphasis.(Important.)')) {
        return 'Expected the exact callout to be inserted immediately after the target sentence.'
      }
      return null
    }),
  },
  {
    name: 'insert transition between paragraphs',
    preferredMode: 'insert',
    seed: 'First paragraph.\n\nSecond paragraph.',
    prompt:
      'Insert exactly "Meanwhile, the plan was changing." immediately before the second paragraph. Do not duplicate, rewrite, or retype any existing paragraph text.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (!result.docText.includes('Meanwhile, the plan was changing.')) {
        return 'Expected the transition sentence to appear in the document.'
      }
      if (!result.docText.startsWith('First paragraph.')) {
        return 'Expected the first paragraph to stay at the front.'
      }
      if ((result.docText.match(/First paragraph\./g) ?? []).length !== 1) {
        return 'Expected the first paragraph to appear exactly once.'
      }
      if ((result.docText.match(/Second paragraph\./g) ?? []).length !== 1) {
        return 'Expected the second paragraph to appear exactly once.'
      }
      return null
    }),
  },
  {
    name: 'add title at top',
    preferredMode: 'insert',
    seed: 'Opening paragraph about the sea.',
    prompt:
      'Add the exact title "Tide Notes" at the very top of the document, before all existing text. Do not append it after the body.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (!result.docText.startsWith('Tide Notes')) {
        return 'Expected the document to begin with the requested title.'
      }
      if (!result.toolCalls.includes('place_cursor_at_document_boundary')) {
        return 'Expected place_cursor_at_document_boundary to be used for top insertion.'
      }
      if (!result.docText.includes('Opening paragraph about the sea.')) {
        return 'Expected the original body text to remain after the title.'
      }
      return null
    }),
  },
  {
    name: 'title existing story at top with heading',
    preferredMode: 'insert',
    seed:
      'At dawn, Mira found a key in the garden with no lock to fit it. She carried it all day until, at sunset, the sky cracked open like a door.',
    prompt:
      'Give it a short title at the very top of the document. Format only the title as a markdown heading and keep the story body below it.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      const json = result.docJson as { content?: Array<{ type?: string; attrs?: { level?: number } }> } | undefined
      if (json?.content?.[0]?.type !== 'heading') {
        return 'Expected the document to begin with a heading title.'
      }
      if ((json.content?.[0]?.attrs?.level ?? 0) < 1) {
        return 'Expected the title heading to have a valid heading level.'
      }
      if (
        !result.docText.includes(
          'At dawn, Mira found a key in the garden with no lock to fit it.',
        )
      ) {
        return 'Expected the original story body to remain intact below the title.'
      }
      return null
    }),
  },
  {
    name: 'rename recurring character everywhere',
    preferredMode: 'insert',
    seed:
      'At midnight, the town’s last streetlamp blinked out, and Mara heard the sea whisper her name. So when morning came, Mara opened the letter she had feared for weeks.',
    prompt: 'Make the story about Kiki instead of Mara.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if ((result.docText.match(/\bKiki\b/g) ?? []).length < 2) {
        return 'Expected all repeated Mara mentions to be replaced with Kiki.'
      }
      if (/\bMara\b/.test(result.docText)) {
        return 'Expected no Mara mentions to remain in the document.'
      }
      if (!result.toolCalls.includes('replace_matches')) {
        return 'Expected replace_matches to be used for repeated exact-name replacement.'
      }
      return null
    }),
  },
  {
    name: 'replace second beta only',
    preferredMode: 'rewrite',
    seed: 'beta one beta two',
    prompt: 'Replace only the second occurrence of the word beta with delta.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (!result.docText.startsWith('beta one')) {
        return 'Expected the first beta occurrence to remain untouched.'
      }
      if (!result.docText.includes('delta two')) {
        return 'Expected the second beta occurrence to be replaced with delta.'
      }
      return null
    }),
  },
  {
    name: 'replace between alpha and delta',
    preferredMode: 'insert',
    seed: 'alpha beta gamma delta',
    prompt:
      'Replace everything between alpha and delta with the exact text " -> ". Keep alpha and delta themselves.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (result.docText !== 'alpha -> delta') {
        return `Expected exact bridge replacement, got ${JSON.stringify(result.docText)}`
      }
      return null
    }),
  },
  {
    name: 'append exact final thought',
    preferredMode: 'continue',
    seed: 'Body text.',
    prompt:
      'Add the exact sentence "Final thought." at the end of the document and do not say anything else.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (!result.docText.endsWith('Final thought.')) {
        return 'Expected the exact final sentence to appear at the end.'
      }
      return null
    }),
  },
  {
    name: 'append signature at very end',
    preferredMode: 'insert',
    seed: 'Body text.',
    prompt:
      'Insert the exact text " -- End" at the very end of the document and nowhere else.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (!result.docText.endsWith(' -- End')) {
        return 'Expected the exact signature text to appear at the very end.'
      }
      if (!result.toolCalls.includes('place_cursor_at_document_boundary')) {
        return 'Expected place_cursor_at_document_boundary to be used for end insertion.'
      }
      return null
    }),
  },
  {
    name: 'add closing paragraph summary',
    preferredMode: 'continue',
    seed: 'The article explains why reliable tools matter in collaborative writing.',
    prompt:
      'Add a short closing paragraph that summarizes the main point and sounds conclusive. Put it in the document.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (!result.docText.startsWith('The article explains why reliable tools matter')) {
        return 'Expected the original document text to remain intact at the front.'
      }
      if (
        result.docText.length <=
        'The article explains why reliable tools matter in collaborative writing.'.length + 15
      ) {
        return 'Expected a non-trivial closing addition.'
      }
      return null
    }),
  },
  {
    name: 'insert parenthetical before final sentence',
    preferredMode: 'insert',
    seed: 'First statement. Final sentence.',
    prompt:
      'Insert the exact text "(quietly) " immediately before the final sentence.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (!result.docText.includes('(quietly) Final sentence.')) {
        return 'Expected the parenthetical to appear immediately before the final sentence.'
      }
      return null
    }),
  },
  {
    name: 'review later part before editing',
    preferredMode: 'insert',
    seed: 'alpha beta gamma delta epsilon zeta',
    prompt:
      'First inspect the later part of the document, then insert the exact marker "[checked]" immediately before the word epsilon.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (!result.toolCalls.includes('get_document_snapshot')) {
        return 'Expected get_document_snapshot to be used for later-part inspection.'
      }
      if (!result.docText.includes('[checked]epsilon') && !result.docText.includes('[checked] epsilon')) {
        return 'Expected the marker to appear immediately before epsilon.'
      }
      return null
    }),
  },
  {
    name: 'clear selection before inserting after alpha',
    preferredMode: 'insert',
    seed: 'alpha beta gamma',
    prompt:
      'Select the word beta, then clear that selection and insert the exact character "!" immediately after alpha.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (!result.toolCalls.includes('clear_selection')) {
        return 'Expected clear_selection to be called.'
      }
      if (!result.docText.startsWith('alpha!')) {
        return 'Expected ! to be inserted immediately after alpha.'
      }
      if (!result.docText.includes('beta')) {
        return 'Expected beta to remain because the selection was cleared before editing.'
      }
      return null
    }),
  },
  {
    name: 'rewrite first sentence as a question',
    preferredMode: 'rewrite',
    seed: 'The harbor was silent. The lamps still burned.',
    prompt:
      'Rewrite the first sentence as a question while keeping the second sentence unchanged.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (!result.docText.endsWith('The lamps still burned.')) {
        return 'Expected the second sentence to remain unchanged.'
      }
      if (!result.docText.includes('?')) {
        return 'Expected the first sentence to become a question.'
      }
      return null
    }),
  },
  {
    name: 'delete only the phrase beta gamma',
    preferredMode: 'rewrite',
    seed: 'alpha beta gamma delta',
    prompt:
      'Delete only the phrase "beta gamma" from the document and leave the rest untouched.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (result.docText.includes('beta gamma')) {
        return 'Expected the phrase beta gamma to be removed.'
      }
      if (!result.docText.startsWith('alpha') || !result.docText.endsWith('delta')) {
        return 'Expected alpha and delta to remain.'
      }
      return null
    }),
  },
  {
    name: 'write a product blurb',
    preferredMode: 'continue',
    prompt:
      'Write a short product blurb for a note-taking app. Put it in the document as exactly two sentences.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if ((result.docText.match(/[.!?]/g) ?? []).length < 2) {
        return 'Expected a two-sentence product blurb.'
      }
      if (result.docText.length < 40) {
        return 'Expected the product blurb to be non-trivial.'
      }
      return null
    }),
  },
  {
    name: 'insert exact subtitle under title',
    preferredMode: 'insert',
    seed: 'Tide Notes\n\nOpening paragraph about the sea.',
    prompt:
      'Insert the exact subtitle "A journal from the coast" directly under the title and above the opening paragraph.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (
        !result.docText.includes('Tide Notes\nA journal from the coast') &&
        !result.docText.includes('Tide Notes\n\nA journal from the coast')
      ) {
        return 'Expected the subtitle to appear directly under the title, with either one or two line breaks.'
      }
      return null
    }),
  },
  {
    name: 'replace conclusion between anchors',
    preferredMode: 'insert',
    seed: 'Intro start middle conclusion end',
    prompt:
      'Replace everything between the words "start" and "end" with the exact text " -> ". Keep the anchor words themselves.',
    validate: chainValidators(validateNoSummaryLeakInDocument, (result) => {
      if (result.docText !== 'Intro start -> end') {
        return `Expected exact anchored replacement, got ${JSON.stringify(result.docText)}`
      }
      return null
    }),
  },
]

async function main() {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    console.error('OPENAI_API_KEY is required for live evals. Load .env or export the key first.')
    process.exit(1)
  }

  console.log(
    `Running ${scenarios.length} live model evals with ${process.env.OPENAI_MODEL?.trim() || 'gpt-5.4'}...`,
  )
  const results: EvalResult[] = []

  for (const scenario of scenarios) {
    console.log(`\n[eval] ${scenario.name}`)
    const result = await runScenario(scenario)
    results.push(result)
    console.log(`tool calls: ${result.toolCalls.join(', ') || '(none)'}`)
    console.log(`doc: ${JSON.stringify(result.docText)}`)
    if (result.chatText) {
      console.log(`chat: ${JSON.stringify(result.chatText)}`)
    }
    if (!result.passed) {
      console.log(`failure: ${result.details}`)
    } else {
      console.log('status: passed')
    }
  }

  const failed = results.filter((result) => !result.passed)
  const observedTools = Array.from(new Set(results.flatMap((result) => result.toolCalls))).sort()
  console.log(`\nObserved tools across live evals: ${observedTools.join(', ') || '(none)'}`)

  if (failed.length > 0) {
    console.error(`\n${failed.length}/${results.length} live eval(s) failed.`)
    process.exit(1)
  }

  console.log(`\nAll ${results.length} live evals passed.`)
}

await main()
