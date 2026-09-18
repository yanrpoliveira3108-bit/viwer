/**
 * Testes da mesclagem/validação de configuração.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeConfig } from '../src/config/Config.js'
import { defaults } from '../src/config/defaults.js'

test('usuário vazio recebe todos os padrões com aviso por seção', () => {
  const issues = []
  const merged = mergeConfig(defaults, {}, (p) => issues.push(p))
  assert.equal(merged.cache.maxEntries, defaults.cache.maxEntries)
  assert.ok(issues.includes('cache'))
})

test('seção parcial avisa as chaves internas ausentes', () => {
  const issues = []
  mergeConfig(defaults, { cache: { ttlMinutes: 5 } }, (p) => issues.push(p))
  assert.ok(issues.includes('cache.maxEntries'))
  assert.ok(!issues.includes('cache.ttlMinutes'))
})

test('valores do usuário são preservados', () => {
  const merged = mergeConfig(defaults, { cache: { maxEntries: 42 } })
  assert.equal(merged.cache.maxEntries, 42)
  // vizinhas mantêm padrão
  assert.equal(merged.cache.ttlMinutes, defaults.cache.ttlMinutes)
})

test('tipo errado volta ao padrão com aviso', () => {
  const issues = []
  const merged = mergeConfig(defaults, { cache: { maxEntries: 'muitos' } }, (p, r) =>
    issues.push(`${p}:${r}`)
  )
  assert.equal(merged.cache.maxEntries, defaults.cache.maxEntries)
  assert.ok(issues.some((i) => i.startsWith('cache.maxEntries')))
})

test('chaves desconhecidas do usuário não contaminam o resultado', () => {
  const merged = mergeConfig(defaults, { inexistente: { a: 1 } })
  assert.equal(merged.inexistente, undefined)
})

test('arrays são tratados como valores folha', () => {
  const merged = mergeConfig(defaults, { connection: { browser: ['X', 'Y', 'Z'] } })
  assert.deepEqual(merged.connection.browser, ['X', 'Y', 'Z'])
})

test('nunca lança exceção (usuário null/lixo)', () => {
  assert.doesNotThrow(() => mergeConfig(defaults, null))
  assert.doesNotThrow(() => mergeConfig(defaults, 'lixo'))
})
