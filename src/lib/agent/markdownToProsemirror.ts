import { Fragment, type Mark, type Node as PMNode } from 'prosemirror-model'
import {
  CODE_INLINE,
  HEADING_1,
  HEADING_2,
  HEADING_3,
  HEADING_4,
  HEADING_5,
  HEADING_6,
  ITALIC_AST,
  ITALIC_UND,
  LINE_BREAK,
  LIST_ITEM,
  LIST_ORDERED,
  LIST_UNORDERED,
  PARAGRAPH,
  STRONG_AST,
  STRONG_UND,
  parser,
  parser_end,
  parser_write,
  type Any_Renderer,
  type Parser,
  type Attr,
  type Token,
} from 'streaming-markdown'
import { schema } from '../editor/schema'

type InlineAtom = { kind: 'text'; text: string; marks: readonly string[] } | { kind: 'hard_break' }

type StreamChild = StreamNode | { type: 'text'; value: string }
type StreamNode = {
  token: number
  attrs: Map<number, string>
  children: StreamChild[]
}

function isTextChild(child: StreamChild): child is { type: 'text'; value: string } {
  return 'type' in child && child.type === 'text'
}

function isTokenNode(child: StreamChild): child is StreamNode {
  return 'token' in child
}

export interface StreamingMarkdownState {
  parser: Parser
  root: StreamNode
}

function createRootNode(): StreamNode {
  return {
    token: 1,
    attrs: new Map(),
    children: [],
  }
}

function createStreamingRendererData(root: StreamNode) {
  return {
    root,
    stack: [root],
  }
}

function createStreamingRenderer(root: StreamNode): Any_Renderer {
  const data = createStreamingRendererData(root)
  return {
    data,
    add_token(data, type: Token) {
      const node: StreamNode = { token: Number(type), attrs: new Map(), children: [] }
      data.stack[data.stack.length - 1]!.children.push(node)
      data.stack.push(node)
    },
    end_token(data) {
      if (data.stack.length > 1) data.stack.pop()
    },
    add_text(data, text: string) {
      if (!text) return
      const parent = data.stack[data.stack.length - 1]!
      const last = parent.children[parent.children.length - 1]
      if (last && 'type' in last && last.type === 'text') {
        last.value += text
      } else {
        parent.children.push({ type: 'text', value: text })
      }
    },
    set_attr(data, type: Attr, value: string) {
      const current = data.stack[data.stack.length - 1]
      current?.attrs.set(Number(type), value)
    },
  }
}

export function createStreamingMarkdownState(): StreamingMarkdownState {
  const root = createRootNode()
  return {
    root,
    parser: parser(createStreamingRenderer(root)),
  }
}

export function writeStreamingMarkdown(state: StreamingMarkdownState, chunk: string): void {
  parser_write(state.parser, chunk)
}

export function endStreamingMarkdown(state: StreamingMarkdownState): void {
  parser_end(state.parser)
}

function textNode(value: string, marks: readonly Mark[] = []): PMNode[] {
  return value.length > 0 ? [schema.text(value, marks)] : []
}

function streamInlineToPm(children: StreamChild[], marks: readonly Mark[] = []): PMNode[] {
  const out: PMNode[] = []
  for (const child of children) {
    if (isTextChild(child)) {
      out.push(...textNode(child.value, marks))
      continue
    }
    switch (child.token) {
      case STRONG_AST:
      case STRONG_UND:
        out.push(...streamInlineToPm(child.children, [...marks, schema.marks.strong.create()]))
        break
      case ITALIC_AST:
      case ITALIC_UND:
        out.push(...streamInlineToPm(child.children, [...marks, schema.marks.em.create()]))
        break
      case CODE_INLINE:
        out.push(...textNode(textFromStreamChildren(child.children), [...marks, schema.marks.code.create()]))
        break
      case LINE_BREAK:
        out.push(schema.nodes.hard_break.create())
        break
      default:
        out.push(...streamInlineToPm(child.children, marks))
    }
  }
  return out
}

function textFromStreamChildren(children: StreamChild[]): string {
  let out = ''
  for (const child of children) {
    if (isTextChild(child)) {
      out += child.value
    } else {
      out += textFromStreamChildren(child.children)
    }
  }
  return out
}

function streamBlocksToPm(children: StreamChild[]): PMNode[] {
  const out: PMNode[] = []
  for (const child of children) {
    if (isTextChild(child)) {
      const inline = textNode(child.value)
      if (inline.length > 0) {
        out.push(schema.nodes.paragraph.create(null, inline))
      }
      continue
    }
    switch (child.token) {
      case PARAGRAPH: {
        const inline = streamInlineToPm(child.children)
        if (inline.length > 0) {
          out.push(schema.nodes.paragraph.create(null, inline))
        }
        break
      }
      case HEADING_1:
      case HEADING_2:
      case HEADING_3:
      case HEADING_4:
      case HEADING_5:
      case HEADING_6: {
        const inline = streamInlineToPm(child.children)
        if (inline.length > 0) {
          out.push(schema.nodes.heading.create({ level: headingLevel(child.token) }, inline))
        }
        break
      }
      case LIST_UNORDERED:
      case LIST_ORDERED: {
        const listNode = child.token === LIST_ORDERED ? schema.nodes.ordered_list : schema.nodes.bullet_list
        const items = child.children
          .filter((nested): nested is StreamNode => isTokenNode(nested) && nested.token === LIST_ITEM)
          .map((item: StreamNode) => {
            const itemBlocks = streamBlocksToPm(item.children)
            return schema.nodes.list_item.create(
              null,
              itemBlocks.length > 0 ? itemBlocks : [schema.nodes.paragraph.create()],
            )
          })
        if (items.length > 0) {
          out.push(listNode.create(null, items))
        }
        break
      }
    }
  }
  return out
}

function headingLevel(token: number): number {
  switch (token) {
    case HEADING_1:
      return 1
    case HEADING_2:
      return 2
    case HEADING_3:
      return 3
    case HEADING_4:
      return 4
    case HEADING_5:
      return 5
    case HEADING_6:
      return 6
    default:
      return 1
  }
}

export function streamStateToProsemirrorDoc(state: StreamingMarkdownState): PMNode {
  const blocks = streamBlocksToPm(state.root.children)
  return schema.nodes.doc.create(null, blocks.length > 0 ? blocks : [schema.nodes.paragraph.create()])
}

export function parseMarkdownDocument(markdown: string): PMNode {
  const state = createStreamingMarkdownState()
  writeStreamingMarkdown(state, markdown)
  endStreamingMarkdown(state)
  return streamStateToProsemirrorDoc(state)
}

export function parseInlineMarkdownFragment(markdown: string): Fragment {
  const doc = parseMarkdownDocument(markdown)
  if (doc.childCount !== 1 || doc.firstChild?.type !== schema.nodes.paragraph) {
    throw new Error('Inline markdown replacement must produce exactly one paragraph')
  }
  return doc.firstChild.content
}

export function isEffectivelyEmptyMarkdownDoc(doc: PMNode): boolean {
  return (
    doc.childCount === 0 ||
    (doc.childCount === 1 &&
      doc.firstChild?.type === schema.nodes.paragraph &&
      doc.firstChild.content.size === 0)
  )
}

function markNames(marks: readonly Mark[]): readonly string[] {
  return marks.map((mark) => mark.type.name)
}

function flattenInline(node: PMNode): InlineAtom[] {
  const out: InlineAtom[] = []
  node.forEach((child) => {
    if (child.type === schema.nodes.hard_break) {
      out.push({ kind: 'hard_break' })
      return
    }
    if (child.isText) {
      out.push({
        kind: 'text',
        text: child.text ?? '',
        marks: markNames(child.marks),
      })
    }
  })
  return out
}

function atomsToFragment(atoms: InlineAtom[]): Fragment {
  const nodes: PMNode[] = []
  for (const atom of atoms) {
    if (atom.kind === 'hard_break') {
      nodes.push(schema.nodes.hard_break.create())
      continue
    }
    const marks = atom.marks.map((name) => schema.marks[name]!.create())
    nodes.push(...textNode(atom.text, marks))
  }
  return Fragment.fromArray(nodes)
}

function blockSignature(node: PMNode): string {
  return JSON.stringify({ type: node.type.name, attrs: node.attrs ?? null })
}

type NodeAppendDiff = {
  canApply: boolean
  appendToTail?: { path: number[]; fragment: Fragment }
  appendedChildren?: { path: number[]; nodes: PMNode[] }
}

function diffNodeForAppend(previous: PMNode, next: PMNode, path: number[] = []): NodeAppendDiff {
  if (previous.eq(next)) {
    return { canApply: true }
  }

  if (previous.isTextblock && next.isTextblock) {
    if (blockSignature(previous) !== blockSignature(next)) {
      return { canApply: false }
    }
    const prevAtoms = flattenInline(previous)
    const nextAtoms = flattenInline(next)
    const suffix: InlineAtom[] = []
    let nextIndex = 0

    for (const prevAtom of prevAtoms) {
      const nextAtom = nextAtoms[nextIndex]
      if (!nextAtom || prevAtom.kind !== nextAtom.kind) {
        return { canApply: false }
      }
      if (prevAtom.kind === 'hard_break') {
        nextIndex++
        continue
      }
      if (
        nextAtom.kind !== 'text' ||
        prevAtom.kind !== 'text' ||
        prevAtom.marks.join(',') !== nextAtom.marks.join(',') ||
        !nextAtom.text.startsWith(prevAtom.text)
      ) {
        return { canApply: false }
      }
      const remainder = nextAtom.text.slice(prevAtom.text.length)
      if (remainder.length > 0) {
        suffix.push({ kind: 'text', text: remainder, marks: nextAtom.marks })
      }
      nextIndex++
    }

    while (nextIndex < nextAtoms.length) {
      suffix.push(nextAtoms[nextIndex]!)
      nextIndex++
    }

    return {
      canApply: true,
      appendToTail: { path, fragment: atomsToFragment(suffix) },
    }
  }

  if (blockSignature(previous) !== blockSignature(next)) {
    return { canApply: false }
  }

  let common = 0
  while (
    common < previous.childCount &&
    common < next.childCount &&
    previous.child(common).eq(next.child(common))
  ) {
    common++
  }

  if (common === previous.childCount) {
    return {
      canApply: true,
      appendedChildren: {
        path,
        nodes:
          common < next.childCount
          ? Array.from({ length: next.childCount - common }, (_, i) => next.child(common + i))
          : [],
      },
    }
  }

  if (common !== previous.childCount - 1 || common >= next.childCount) {
    return { canApply: false }
  }

  const childDiff = diffNodeForAppend(previous.child(common), next.child(common), [...path, common])
  if (!childDiff.canApply) {
    return { canApply: false }
  }

  return {
    canApply: true,
    appendToTail: childDiff.appendToTail,
    appendedChildren:
      common + 1 < next.childCount
        ? {
            path,
            nodes: Array.from({ length: next.childCount - (common + 1) }, (_, i) =>
              next.child(common + 1 + i),
            ),
          }
        : childDiff.appendedChildren,
  }
}

export function diffMarkdownDocsForAppend(
  previousDoc: PMNode | null,
  nextDoc: PMNode,
): {
  canApply: boolean
  appendToLastBlock?: { path: number[]; fragment: Fragment }
  appendedBlocks?: { path: number[]; nodes: PMNode[] }
  nextDoc: PMNode
} {
  if (!previousDoc || isEffectivelyEmptyMarkdownDoc(previousDoc)) {
    return {
      canApply: true,
      appendedBlocks: {
        path: [],
        nodes: Array.from({ length: nextDoc.childCount }, (_, i) => nextDoc.child(i)),
      },
      nextDoc,
    }
  }

  const diff = diffNodeForAppend(previousDoc, nextDoc)

  return {
    canApply: diff.canApply,
    appendToLastBlock: diff.appendToTail,
    appendedBlocks: diff.appendedChildren,
    nextDoc,
  }
}
