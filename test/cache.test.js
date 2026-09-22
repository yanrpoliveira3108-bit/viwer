/**
 * Testes do cache de mensagens View Once.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { MessageCache } from '../src/cache/MessageCache.js'

function fakeMessage(id, remoteJid = 'chat@s.whatsapp.net') {
  return {
    key: { remoteJid, id, fromMe: false },
    message: { viewOnceMessage: { message: { imageMessage: { url: 'u', mediaKey: 'k' } } } },
  }
}

function makeCache(overrides = {}) {
  return new MessageCache({
    maxEntries: 3,
    ttlMs: 60_000,
    sweepIntervalMs: 3_600_000, // varredura manual nos testes
    ...overrides,
  })
}

test('set/lookup por chat+id', () => {
  const cache = makeCache()
  cache.set(fakeMessage('A'), 'image')
  const entry = cache.lookup('chat@s.whatsapp.net', 'A')
  assert.ok(entry)
  assert.equal(entry.mediaType, 'image')
  assert.equal(cache.lookup('chat@s.whatsapp.net', 'B'), null)
  assert.equal(cache.lookup('outro@s.whatsapp.net', 'A'), null)
  cache.close()
})

test('evicção do registro mais antigo ao estourar capacidade', () => {
  const cache = makeCache({ maxEntries: 2 })
  cache.set(fakeMessage('A'), 'image')
  cache.set(fakeMessage('B'), 'image')
  cache.set(fakeMessage('C'), 'image')
  assert.equal(cache.lookup('chat@s.whatsapp.net', 'A'), null)
  assert.ok(cache.lookup('chat@s.whatsapp.net', 'B'))
  assert.ok(cache.lookup('chat@s.whatsapp.net', 'C'))
  cache.close()
})

test('TTL remove registros vencidos', () => {
  const cache = makeCache({ ttlMs: 1 })
  cache.set(fakeMessage('A'), 'image')
  // força expiração
  for (const [, entry] of cache.index) entry.at = Date.now() - 10
  assert.equal(cache.lookup('chat@s.whatsapp.net', 'A'), null)
  cache.close()
})

test('sweep limpa vencidos', () => {
  const cache = makeCache({ ttlMs: 1 })
  cache.set(fakeMessage('A'), 'image')
  for (const [, entry] of cache.index) entry.at = Date.now() - 10
  cache.sweep()
  assert.equal(cache.size, 0)
  cache.close()
})

test('processadas impedem duplicidade', () => {
  const cache = makeCache()
  assert.equal(cache.isProcessed('A'), false)
  cache.markProcessed('A')
  assert.equal(cache.isProcessed('A'), true)
  cache.close()
})

test('in-flight impede processamento concorrente', () => {
  const cache = makeCache()
  assert.equal(cache.markInFlight('A'), true)
  assert.equal(cache.markInFlight('A'), false) // segunda reserva negada
  cache.releaseInFlight('A')
  assert.equal(cache.markInFlight('A'), true)
  cache.close()
})

test('mensagens sem id/jid são ignoradas sem erro', () => {
  const cache = makeCache()
  cache.set({ key: {}, message: {} }, 'image')
  assert.equal(cache.size, 0)
  cache.close()
})
