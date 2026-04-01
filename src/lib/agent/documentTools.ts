import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'
import { DocumentToolRuntime } from './documentToolRuntime'
import type { FormatAction, FormatKind, FormatName } from './documentToolRuntime'
import type { AgentRunMode } from './types'

const getDocumentSnapshotDef = toolDefinition({
  name: 'get_document_snapshot',
  description:
    'Read a plain-text snapshot of the current document so you can decide where to edit.',
  inputSchema: z.object({
    startChar: z.number().int().min(0).optional(),
    maxChars: z.number().int().min(200).max(12000).optional(),
  }),
})

const getSelectionSnapshotDef = toolDefinition({
  name: 'get_selection_snapshot',
  description:
    'Read the currently active selection, if there is one, including the selected text and exact range. Use this when the user refers to "this" or the current selection and you want to inspect it before editing.',
})

const getCursorContextDef = toolDefinition({
  name: 'get_cursor_context',
  description:
    'Read nearby plain-text context around the current cursor location. Use this when the user says "here" and you want to inspect the insertion point before editing.',
  inputSchema: z.object({
    maxCharsBefore: z.number().int().min(0).max(1000).optional(),
    maxCharsAfter: z.number().int().min(0).max(1000).optional(),
  }),
})

const searchTextDef = toolDefinition({
  name: 'search_text',
  description:
    'Search for exact text inside the document and return stable match handles with surrounding context.',
  inputSchema: z.object({
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(20).optional(),
  }),
})

const replaceMatchesDef = toolDefinition({
  name: 'replace_matches',
  description:
    'Replace multiple previously found exact matches in one step. Use this after search_text when the user wants the same exact text changed in several places, such as renaming a character throughout the document. Set contentFormat to markdown when the replacement string uses inline markdown like **bold**, *italic*, or `code` and should become formatting instead of literal punctuation.',
  inputSchema: z.object({
    matchIds: z.array(z.string().min(1)).min(1).max(50),
    text: z.string(),
    contentFormat: z.enum(['plain_text', 'markdown']).optional(),
  }),
})

const placeCursorDef = toolDefinition({
  name: 'place_cursor',
  description:
    'Place the agent cursor at the start or end of a previously returned match handle.',
  inputSchema: z.object({
    matchId: z.string().min(1),
    edge: z.enum(['start', 'end']).optional(),
  }),
})

const placeCursorAtDocumentBoundaryDef = toolDefinition({
  name: 'place_cursor_at_document_boundary',
  description:
    'Place the agent cursor at the very start or very end of the document. Use this for requests like adding a title at the top or appending exact text at the end.',
  inputSchema: z.object({
    boundary: z.enum(['start', 'end']),
  }),
})

const insertParagraphBreakDef = toolDefinition({
  name: 'insert_paragraph_break',
  description:
    'Create a new empty paragraph block at the current cursor position and move the cursor into it. Use this when the user asks for a second paragraph, a new paragraph, or a closing paragraph as a distinct block.',
})

const selectTextDef = toolDefinition({
  name: 'select_text',
  description: 'Select the exact text represented by a previously returned match handle.',
  inputSchema: z.object({
    matchId: z.string().min(1),
  }),
})

const selectCurrentBlockDef = toolDefinition({
  name: 'select_current_block',
  description:
    'Select the full current text block around the cursor. Use this for formatting or rewriting the current line/paragraph when you already know the cursor is in the right block.',
})

const selectBetweenMatchesDef = toolDefinition({
  name: 'select_between_matches',
  description:
    'Create a selection between two previously returned matches, choosing start/end edges for each.',
  inputSchema: z.object({
    startMatchId: z.string().min(1),
    endMatchId: z.string().min(1),
    startEdge: z.enum(['start', 'end']).optional(),
    endEdge: z.enum(['start', 'end']).optional(),
  }),
})

const clearSelectionDef = toolDefinition({
  name: 'clear_selection',
  description: 'Clear the current selection while keeping the current cursor target.',
})

const setFormatDef = toolDefinition({
  name: 'set_format',
  description:
    'Apply formatting to the current selection. Use this after selecting text for marks like bold/italic/code or block formats like paragraph, heading, bullet list, or ordered list.',
  inputSchema: z.object({
    kind: z.enum(['mark', 'block']),
    format: z.enum(['bold', 'italic', 'code', 'paragraph', 'heading', 'bullet_list', 'ordered_list']),
    action: z.enum(['add', 'remove', 'toggle', 'set']).optional(),
    level: z.number().int().min(1).max(6).optional(),
  }),
})

const insertTextDef = toolDefinition({
  name: 'insert_text',
  description:
    'Insert text at the current cursor. If a selection exists, it will be replaced. Use plain_text for exact literal strings that should appear verbatim in the document. Set contentFormat to markdown when short inline markdown like **bold**, *italic*, or `code` should become real formatting instead of literal punctuation.',
  inputSchema: z.object({
    text: z.string(),
    contentFormat: z.enum(['plain_text', 'markdown']).optional(),
  }),
})

const deleteSelectionDef = toolDefinition({
  name: 'delete_selection',
  description: 'Delete the current selection, if there is one.',
})

const startStreamingEditDef = toolDefinition({
  name: 'start_streaming_edit',
  description:
    'Arm the next assistant text message for document insertion at the current cursor or selection. Use this when the user wants actual document prose written, such as a story, paragraph, continuation, or rewrite. While active, output only document prose, not explanations. Set contentFormat to markdown when you want streamed markdown to become structured document formatting. Use rewrite mode only when a selection is already set.',
  inputSchema: z.object({
    mode: z.enum(['continue', 'insert', 'rewrite']),
    contentFormat: z.enum(['plain_text', 'markdown']).optional(),
  }),
})

const stopStreamingEditDef = toolDefinition({
  name: 'stop_streaming_edit',
  description:
    'Stop the currently armed streaming edit. Normally the server auto-stops at message end, so this is mainly for cancelling or early exit.',
})

export function createDocumentTools(runtime: DocumentToolRuntime) {
  return [
    getDocumentSnapshotDef.server(async ({ maxChars, startChar }) =>
      runtime.getDocumentSnapshot(maxChars, startChar),
    ),
    getSelectionSnapshotDef.server(async () => {
      const snapshot = runtime.getSelectionSnapshot()
      return snapshot ? { ok: true, ...snapshot } : { ok: false, reason: 'No active selection' }
    }),
    getCursorContextDef.server(async ({ maxCharsBefore, maxCharsAfter }) => {
      const context = runtime.getCursorContext(maxCharsBefore, maxCharsAfter)
      return context ? { ok: true, ...context } : { ok: false, reason: 'No active cursor' }
    }),
    searchTextDef.server(async ({ query, maxResults }) => ({
      ok: true,
      matches: runtime.searchText(query, maxResults),
    })),
    replaceMatchesDef.server(async ({ matchIds, text, contentFormat }, context) => {
      const result = runtime.replaceMatches(
        matchIds,
        text,
        (contentFormat as 'plain_text' | 'markdown' | undefined) ?? 'plain_text',
      )
      context?.emitCustomEvent('agent-edit-applied', {
        kind: 'replace_matches',
        count: result.replacedCount,
        chars: text.length,
      })
      return result
    }),
    placeCursorDef.server(async ({ matchId, edge }, context) => {
      const result = runtime.placeCursor(matchId, edge)
      context?.emitCustomEvent('agent-cursor-updated', { matchId, edge: edge ?? 'start' })
      return result
    }),
    placeCursorAtDocumentBoundaryDef.server(async ({ boundary }, context) => {
      const result = runtime.placeCursorAtDocumentBoundary(boundary)
      context?.emitCustomEvent('agent-cursor-updated', { boundary })
      return result
    }),
    insertParagraphBreakDef.server(async (_input, context) => {
      const result = runtime.insertParagraphBreak()
      context?.emitCustomEvent('agent-edit-applied', { kind: 'insert_paragraph_break' })
      return result
    }),
    selectTextDef.server(async ({ matchId }, context) => {
      const result = runtime.selectText(matchId)
      context?.emitCustomEvent('agent-selection-updated', { matchId })
      return result
    }),
    selectCurrentBlockDef.server(async (_args, context) => {
      const result = runtime.selectCurrentBlock()
      context?.emitCustomEvent('agent-selection-updated', { currentBlock: true })
      return result
    }),
    selectBetweenMatchesDef.server(async (args, context) => {
      const result = runtime.selectBetweenMatches(
        args.startMatchId,
        args.endMatchId,
        args.startEdge,
        args.endEdge,
      )
      context?.emitCustomEvent('agent-selection-updated', {
        startMatchId: args.startMatchId,
        endMatchId: args.endMatchId,
      })
      return result
    }),
    clearSelectionDef.server(async (_args, context) => {
      const result = runtime.clearSelection()
      context?.emitCustomEvent('agent-selection-cleared', {})
      return result
    }),
    setFormatDef.server(async ({ kind, format, action, level }, context) => {
      const result = runtime.setFormat({
        kind: kind as FormatKind,
        format: format as FormatName,
        action: action as FormatAction | undefined,
        level,
      })
      context?.emitCustomEvent('agent-format-applied', {
        kind,
        format,
        action: result.action,
        ...(typeof level === 'number' ? { level } : {}),
      })
      return result
    }),
    insertTextDef.server(async ({ text, contentFormat }, context) => {
      const result = runtime.insertText(
        text,
        (contentFormat as 'plain_text' | 'markdown' | undefined) ?? 'plain_text',
      )
      context?.emitCustomEvent('agent-edit-applied', { kind: 'insert_text', chars: text.length })
      return result
    }),
    deleteSelectionDef.server(async (_args, context) => {
      const result = runtime.deleteSelection()
      context?.emitCustomEvent('agent-edit-applied', { kind: 'delete_selection' })
      return result
    }),
    startStreamingEditDef.server(async ({ mode, contentFormat }, context) => {
      const result = runtime.startStreamingEdit(
        mode as AgentRunMode,
        (contentFormat as 'plain_text' | 'markdown' | undefined) ?? 'plain_text',
      )
      context?.emitCustomEvent('agent-streaming-edit', {
        active: true,
        mode,
        contentFormat: result.contentFormat,
      })
      return result
    }),
    stopStreamingEditDef.server(async (_args, context) => {
      const result = runtime.stopStreamingEdit(false)
      context?.emitCustomEvent('agent-streaming-edit', { active: false })
      return result
    }),
  ]
}
