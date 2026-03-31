import { Fragment, type Mark, type Node as PMNode } from 'prosemirror-model'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { schema } from '../editor/schema'

type MNode = {
  type: string
  value?: string
  depth?: number
  ordered?: boolean
  children?: MNode[]
}

type InlineAtom = { kind: 'text'; text: string; marks: readonly string[] } | { kind: 'hard_break' }

function textNode(value: string, marks: readonly Mark[] = []): PMNode[] {
  return value.length > 0 ? [schema.text(value, marks)] : []
}

function mdastInlineToPm(nodes: MNode[], marks: readonly Mark[] = []): PMNode[] {
  const out: PMNode[] = []
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out.push(...textNode(node.value ?? '', marks))
        break
      case 'strong':
        out.push(...mdastInlineToPm(node.children ?? [], [...marks, schema.marks.strong.create()]))
        break
      case 'emphasis':
        out.push(...mdastInlineToPm(node.children ?? [], [...marks, schema.marks.em.create()]))
        break
      case 'inlineCode':
        out.push(...textNode(node.value ?? '', [...marks, schema.marks.code.create()]))
        break
      case 'break':
        out.push(schema.nodes.hard_break.create())
        break
      default:
        if (Array.isArray(node.children)) {
          out.push(...mdastInlineToPm(node.children, marks))
        }
    }
  }
  return out
}

function mdastBlocksToPm(nodes: MNode[]): PMNode[] {
  const out: PMNode[] = []
  for (const node of nodes) {
    switch (node.type) {
      case 'paragraph': {
        const inline = mdastInlineToPm(node.children ?? [])
        if (inline.length > 0) {
          out.push(schema.nodes.paragraph.create(null, inline))
        }
        break
      }
      case 'heading': {
        const inline = mdastInlineToPm(node.children ?? [])
        if (inline.length > 0) {
          out.push(schema.nodes.heading.create({ level: node.depth ?? 1 }, inline))
        }
        break
      }
      case 'list': {
        const listNode = node.ordered ? schema.nodes.ordered_list : schema.nodes.bullet_list
        const items = (node.children ?? [])
          .filter((child) => child.type === 'listItem')
          .map((item) => {
            const itemBlocks = mdastBlocksToPm(item.children ?? [])
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

export function parseMarkdownDocument(markdown: string): PMNode {
  const root = fromMarkdown(markdown) as MNode
  const blocks = mdastBlocksToPm(root.children ?? [])
  return schema.nodes.doc.create(null, blocks.length > 0 ? blocks : [schema.nodes.paragraph.create()])
}

export function isSingleParagraphMarkdownDoc(doc: PMNode): boolean {
  return doc.childCount === 1 && doc.firstChild?.type === schema.nodes.paragraph
}

export function markdownDocInlineFragment(doc: PMNode): Fragment | null {
  if (!isSingleParagraphMarkdownDoc(doc)) {
    return null
  }
  return doc.firstChild!.content
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

export function diffMarkdownDocsForAppend(
  previousDoc: PMNode | null,
  nextDoc: PMNode,
): {
  canApply: boolean
  appendToLastBlock?: Fragment
  appendedBlocks?: PMNode[]
  nextDoc: PMNode
} {
  if (!previousDoc || isEffectivelyEmptyMarkdownDoc(previousDoc)) {
    return {
      canApply: true,
      appendedBlocks: Array.from({ length: nextDoc.childCount }, (_, i) => nextDoc.child(i)),
      nextDoc,
    }
  }

  let common = 0
  while (
    common < previousDoc.childCount &&
    common < nextDoc.childCount &&
    previousDoc.child(common).eq(nextDoc.child(common))
  ) {
    common++
  }

  if (common === previousDoc.childCount) {
    return {
      canApply: true,
      appendedBlocks:
        common < nextDoc.childCount
          ? Array.from({ length: nextDoc.childCount - common }, (_, i) => nextDoc.child(common + i))
          : [],
      nextDoc,
    }
  }

  if (common !== previousDoc.childCount - 1 || common >= nextDoc.childCount) {
    return { canApply: false, nextDoc }
  }

  const prevLast = previousDoc.child(common)
  const nextLast = nextDoc.child(common)
  if (blockSignature(prevLast) !== blockSignature(nextLast)) {
    return { canApply: false, nextDoc }
  }

  const prevAtoms = flattenInline(prevLast)
  const nextAtoms = flattenInline(nextLast)
  const suffix: InlineAtom[] = []
  let nextIndex = 0

  for (const prevAtom of prevAtoms) {
    const nextAtom = nextAtoms[nextIndex]
    if (!nextAtom || prevAtom.kind !== nextAtom.kind) {
      return { canApply: false, nextDoc }
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
      return { canApply: false, nextDoc }
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
    appendToLastBlock: atomsToFragment(suffix),
    appendedBlocks:
      common + 1 < nextDoc.childCount
        ? Array.from({ length: nextDoc.childCount - (common + 1) }, (_, i) => nextDoc.child(common + 1 + i))
        : [],
    nextDoc,
  }
}
