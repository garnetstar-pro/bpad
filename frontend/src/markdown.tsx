import type { Components } from 'react-markdown'

// Open links in notes in a new tab (and safely: noopener/noreferrer).
export const markdownComponents: Components = {
  a({ node: _node, ...props }) {
    return <a {...props} target="_blank" rel="noopener noreferrer" />
  },
}
