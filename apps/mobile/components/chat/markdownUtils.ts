/** Recursively extract plain text from a react-native-markdown-display AST node. */
export function extractTextFromNode(node: any): string {
  if (!node) return ''
  if (typeof node.content === 'string') return node.content
  if (Array.isArray(node.children)) {
    return node.children.map(extractTextFromNode).join('')
  }
  return ''
}
