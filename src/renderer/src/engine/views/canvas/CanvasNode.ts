// Canvas cards: re-exports the node classes, split across sibling modules.
//   CanvasNode        base: geometry, z-order, selection classes, drag/resize/connect, base menu
//   ContentNode       content mounted only above the zoom breakpoint (placeholder below)
//   EmbedNode         content is a child component (markdown preview/editor, file embed)
//   TextNode / FileNode / LinkNode / GroupNode, DummyNode (drag previews, edge-drop targets)
export { CanvasNode, DummyNode, nearestSide } from './CanvasNodeBase'
export { ContentNode, EmbedNode } from './CanvasContentNodes'
export type { NodeChild } from './CanvasContentNodes'
export { TextNode } from './CanvasTextNode'
export { FileNode } from './CanvasFileNode'
export { LinkNode } from './CanvasLinkNode'
export { GroupNode, sameBBox } from './CanvasGroupNode'
