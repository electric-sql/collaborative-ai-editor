import OrderedMap from 'orderedmap'
import { Schema } from 'prosemirror-model'
import { nodes, marks } from 'prosemirror-schema-basic'
import { addListNodes } from 'prosemirror-schema-list'

export const schema = new Schema({
  nodes: addListNodes(OrderedMap.from(nodes), 'paragraph block*', 'block'),
  marks,
})
