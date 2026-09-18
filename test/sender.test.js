/**
 * Testes da construção do conteúdo de reenvio (sem View Once, com metadados).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOutgoingContent } from '../src/viewer/sender.js'

test('imagem preserva legenda, mimetype e thumbnail', () => {
  const content = buildOutgoingContent({
    mediaType: 'image',
    mediaMessage: { caption: 'foto', mimetype: 'image/jpeg', jpegThumbnail: 'AAA' },
    filePath: '/tmp/a.jpg',
  })
  assert.equal(content.image.url, '/tmp/a.jpg')
  assert.equal(content.caption, 'foto')
  assert.equal(content.mimetype, 'image/jpeg')
  assert.equal(content.jpegThumbnail, 'AAA')
  assert.equal(content.viewOnce, undefined) // nunca reenvia como VO
})

test('GIF mantém flag gifPlayback', () => {
  const content = buildOutgoingContent({
    mediaType: 'gif',
    mediaMessage: { mimetype: 'video/mp4' },
    filePath: '/tmp/g.mp4',
  })
  assert.equal(content.gifPlayback, true)
})

test('áudio preserva ptt e duração', () => {
  const content = buildOutgoingContent({
    mediaType: 'audio',
    mediaMessage: { ptt: true, seconds: 7, mimetype: 'audio/ogg; codecs=opus' },
    filePath: '/tmp/v.ogg',
  })
  assert.equal(content.ptt, true)
  assert.equal(content.seconds, 7)
  assert.equal(content.audio.url, '/tmp/v.ogg')
})

test('documento preserva nome e mimetype', () => {
  const content = buildOutgoingContent({
    mediaType: 'document',
    mediaMessage: { fileName: 'relatorio.pdf', mimetype: 'application/pdf', caption: 'segue' },
    filePath: '/tmp/r.pdf',
  })
  assert.equal(content.fileName, 'relatorio.pdf')
  assert.equal(content.mimetype, 'application/pdf')
  assert.equal(content.caption, 'segue')
})

test('sticker usa mimetype padrão quando ausente', () => {
  const content = buildOutgoingContent({
    mediaType: 'sticker',
    mediaMessage: null,
    filePath: '/tmp/s.webp',
  })
  assert.equal(content.sticker.url, '/tmp/s.webp')
  assert.equal(content.mimetype, 'image/webp')
})

test('tipo futuro cai para documento genérico', () => {
  const content = buildOutgoingContent({
    mediaType: 'holograma',
    mediaMessage: null,
    filePath: '/tmp/h.bin',
  })
  assert.ok(content.document)
})
