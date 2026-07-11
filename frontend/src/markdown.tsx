import type { Components } from 'react-markdown'

// Odkazy v poznámkách otevírej v nové kartě (a bezpečně: noopener/noreferrer).
export const markdownComponents: Components = {
  a({ node: _node, ...props }) {
    return <a {...props} target="_blank" rel="noopener noreferrer" />
  },
}
