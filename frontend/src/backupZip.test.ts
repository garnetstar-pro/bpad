import { describe, it, expect } from 'vitest'
import { zipFiles, unzipFiles, looksLikeZip } from './backupZip'

const enc = new TextEncoder()
const dec = new TextDecoder()

describe('zipFiles / unzipFiles', () => {
  it('round-trips text and binary entries', () => {
    const binary = new Uint8Array([0, 1, 2, 253, 254, 255])
    const archive = zipFiles({
      'backup.json': { bytes: enc.encode('{"a":1}') },
      'images/x.webp': { bytes: binary, compress: false },
    })
    const back = unzipFiles(archive)
    expect(Object.keys(back).sort()).toEqual(['backup.json', 'images/x.webp'])
    expect(dec.decode(back['backup.json'])).toBe('{"a":1}')
    expect(back['images/x.webp']).toEqual(binary)
  })

  it('keeps nested folder paths', () => {
    const archive = zipFiles({ 'notes/2026-01-01-a.md': { bytes: enc.encode('# a') } })
    expect(Object.keys(unzipFiles(archive))).toContain('notes/2026-01-01-a.md')
  })

  it('handles an archive with a single entry and no images', () => {
    const archive = zipFiles({ 'backup.json': { bytes: enc.encode('{}') } })
    expect(Object.keys(unzipFiles(archive))).toEqual(['backup.json'])
  })

  it('survives a large incompressible payload', () => {
    const noise = new Uint8Array(200_000)
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) % 256
    const archive = zipFiles({ 'images/n.webp': { bytes: noise, compress: false } })
    expect(unzipFiles(archive)['images/n.webp']).toEqual(noise)
  })
})

describe('looksLikeZip', () => {
  it('recognises an archive we just built', () => {
    expect(looksLikeZip(zipFiles({ 'a.txt': { bytes: enc.encode('x') } }))).toBe(true)
  })

  it('rejects JSON text', () => {
    expect(looksLikeZip(enc.encode('{"format":"bpad-backup"}'))).toBe(false)
  })

  it('rejects a buffer shorter than the magic bytes', () => {
    expect(looksLikeZip(new Uint8Array([0x50, 0x4b]))).toBe(false)
  })
})
