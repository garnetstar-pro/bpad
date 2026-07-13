export interface Note {
  id: string
  title: string
  content: string
  url: string | null
  created_at: string
  updated_at: string
  tags: string[]
}
