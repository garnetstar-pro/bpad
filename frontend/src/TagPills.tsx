import { Link } from 'react-router-dom'

// Read-only pill row; each pill links to the list filtered by that tag.
// stopPropagation so a pill inside a clickable list entry doesn't also open
// the note.
export function TagPills({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <div className="tag-pills">
      {tags.map((tag) => (
        <Link
          className="tag-pill"
          key={tag}
          to={`/?tags=${encodeURIComponent(tag)}`}
          onClick={(e) => e.stopPropagation()}
        >
          {tag}
        </Link>
      ))}
    </div>
  )
}
