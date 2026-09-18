/**
 * Testes dos utilitários puros (texto, tempo, semver).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  visibleLength,
  stripAnsi,
  truncate,
  pad,
  center,
  progressBar,
  formatBytes,
} from '../src/utils/text.js'
import { formatUptime } from '../src/utils/time.js'
import { parseSemver, compareSemver, isSemver } from '../src/utils/semver.js'
import { resolveExtension } from '../src/viewer/downloader.js'

test('stripAnsi e visibleLength ignoram códigos ANSI', () => {
  const decorated = '\x1b[31mhello\x1b[0m'
  assert.equal(stripAnsi(decorated), 'hello')
  assert.equal(visibleLength(decorated), 5)
})

test('truncate corta com sufixo', () => {
  assert.equal(truncate('abcdefghij', 5), 'abcd…')
  assert.equal(truncate('abc', 5), 'abc')
})

test('pad e center respeitam largura visível', () => {
  assert.equal(visibleLength(pad('ab', 6)), 6)
  assert.equal(visibleLength(center('ab', 7)), 7)
})

test('progressBar satura limites', () => {
  assert.equal(progressBar(0, 10), '░'.repeat(10))
  assert.equal(progressBar(1, 10), '█'.repeat(10))
  assert.equal(progressBar(5, 10), '█'.repeat(10))
})

test('formatBytes usa unidades legíveis', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB')
})

test('formatUptime compõe dias/horas', () => {
  assert.equal(formatUptime(0), '00:00:00')
  assert.equal(formatUptime(3661 * 1000), '01:01:01')
  assert.equal(formatUptime((86400 + 3661) * 1000), '1d 01:01:01')
})

test('semver parse/comparação', () => {
  assert.deepEqual(parseSemver('v1.2.3'), [1, 2, 3])
  assert.deepEqual(parseSemver('1.2.3-beta.1'), [1, 2, 3])
  assert.equal(parseSemver('lixo'), null)
  assert.equal(isSemver('2.0.0'), true)
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0)
  assert.equal(compareSemver('1.0.1', '1.0.0'), 1)
  assert.equal(compareSemver('1.9.9', '2.0.0'), -1)
})

test('resolveExtension prioriza nome do arquivo em documentos', () => {
  assert.equal(resolveExtension('document', { fileName: 'a.pdf' }), '.pdf')
  assert.equal(resolveExtension('document', { mimetype: 'application/zip' }), '.zip')
  assert.equal(resolveExtension('image', {}), '.jpg')
  assert.equal(resolveExtension('audio', { mimetype: 'audio/mpeg' }), '.mp3')
  assert.equal(resolveExtension('sticker', null), '.webp')
})
