import { describe, it, expect } from 'vitest'
import { buildArchive, readArchive, openArchive, type ArchiveImage } from './backupArchive'
import { unzipFiles } from './backupZip'
import { isEncrypted } from './backup'
import type { Note } from './types'

const dec = new TextDecoder()

const note: Note = {
  id: 'server-id',
  title: 'Recipe',
  content: '# Recipe\n![](bpad-img:pic-1)',
  url: null,
  created_at: '2026-01-02T03:04:05Z',
  updated_at: '2026-01-02T03:04:05Z',
  tags: ['food'],
}

const picture: ArchiveImage = {
  id: 'pic-1',
  content_type: 'image/webp',
  bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]),
}

describe('buildArchive — plain', () => {
  it('writes backup.json, the image and the readable markdown', async () => {
    const archive = await buildArchive({ notes: [note], images: [picture], username: 'jan' })
    const names = Object.keys(unzipFiles(archive)).sort()
    expect(names).toEqual([
      'backup.json',
      'images/pic-1.webp',
      'notes/2026-01-02-recipe.md',
    ])
  })

  it('lists the image in the manifest with its plaintext size', async () => {
    const archive = await buildArchive({ notes: [note], images: [picture], username: 'jan' })
    const manifest = JSON.parse(dec.decode(unzipFiles(archive)['backup.json']))
    expect(manifest.version).toBe(2)
    expect(manifest.images).toEqual([
      { id: 'pic-1', content_type: 'image/webp', size_bytes: 8, path: 'images/pic-1.webp' },
    ])
  })

  it('leaves the note content referencing bpad-img, not a path', async () => {
    const archive = await buildArchive({ notes: [note], images: [picture], username: 'jan' })
    const manifest = JSON.parse(dec.decode(unzipFiles(archive)['backup.json']))
    expect(manifest.notes[0].content).toContain('bpad-img:pic-1')
  })

  it('points the markdown export at the relative image path', async () => {
    const archive = await buildArchive({ notes: [note], images: [picture], username: 'jan' })
    const md = dec.decode(unzipFiles(archive)['notes/2026-01-02-recipe.md'])
    expect(md).toContain('![](../images/pic-1.webp)')
  })

  it('builds an archive for a vault with no images at all', async () => {
    const archive = await buildArchive({ notes: [note], images: [], username: 'jan' })
    const names = Object.keys(unzipFiles(archive)).sort()
    expect(names).toEqual(['backup.json', 'notes/2026-01-02-recipe.md'])
  })
})

describe('buildArchive — encrypted', () => {
  it('seals the manifest and the image, and writes no readable markdown', async () => {
    const archive = await buildArchive({
      notes: [note],
      images: [picture],
      username: 'jan',
      passphrase: 'correct horse battery staple',
    })
    const entries = unzipFiles(archive)
    expect(Object.keys(entries).sort()).toEqual(['backup.json', 'images/pic-1.bin'])
    const manifest = JSON.parse(dec.decode(entries['backup.json']))
    expect(manifest.encrypted).toBe(true)
    expect(JSON.stringify(manifest)).not.toContain('Recipe')
    expect(entries['images/pic-1.bin']).not.toEqual(picture.bytes)
  }, 60_000)
})

describe('readArchive / openArchive', () => {
  it('round-trips a plain archive', async () => {
    const archive = await buildArchive({ notes: [note], images: [picture], username: 'jan' })
    const opened = await openArchive(readArchive(archive))
    expect(opened.notes[0].title).toBe('Recipe')
    expect(opened.images.get('pic-1')?.bytes).toEqual(picture.bytes)
    expect(opened.images.get('pic-1')?.content_type).toBe('image/webp')
  })

  it('round-trips an encrypted archive with the passphrase', async () => {
    const archive = await buildArchive({
      notes: [note],
      images: [picture],
      username: 'jan',
      passphrase: 'correct horse battery staple',
    })
    const opened = await openArchive(readArchive(archive), 'correct horse battery staple')
    expect(opened.notes[0].content).toContain('bpad-img:pic-1')
    expect(opened.images.get('pic-1')?.bytes).toEqual(picture.bytes)
  }, 60_000)

  it('rejects the wrong passphrase', async () => {
    const archive = await buildArchive({
      notes: [note],
      images: [picture],
      username: 'jan',
      passphrase: 'right passphrase here',
    })
    await expect(openArchive(readArchive(archive), 'wrong passphrase here')).rejects.toThrow(
      /passphrase/i,
    )
  }, 60_000)

  it('exposes the header before the passphrase is known', async () => {
    const archive = await buildArchive({
      notes: [note],
      images: [],
      username: 'jan',
      passphrase: 'correct horse battery staple',
    })
    const handle = readArchive(archive)
    expect(handle.file.username).toBe('jan')
    expect(isEncrypted(handle.file)).toBe(true)
  }, 60_000)

  it('skips an image the manifest lists but the archive does not carry', async () => {
    const archive = await buildArchive({ notes: [note], images: [picture], username: 'jan' })
    const handle = readArchive(archive)
    delete handle.entries['images/pic-1.webp']
    const opened = await openArchive(handle)
    expect(opened.notes).toHaveLength(1)
    expect(opened.images.size).toBe(0)
  })

  it('rejects an archive with no backup.json', () => {
    const bogus = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])
    expect(() => readArchive(bogus)).toThrow()
  })
})
