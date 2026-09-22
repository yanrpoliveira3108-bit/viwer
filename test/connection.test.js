/**
 * @file test/connection.test.js
 * Normalização do número de telefone para o Pairing Code: o servidor do
 * WhatsApp vincula o código ao número EXATO, então a normalização precisa
 * ser determinística e recusar formatos ambíguos.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBrPhoneNumber, nextRateLimitCooldownMs } from '../src/connection/Connection.js'

test('número completo com DDI passa sem ajustes', () => {
  const { digits, notes } = normalizeBrPhoneNumber('5519912345678')
  assert.equal(digits, '5519912345678')
  assert.equal(notes.length, 0)
})

test('aceita formatação com máscara e espaços', () => {
  const { digits } = normalizeBrPhoneNumber('+55 (19) 91234-5678')
  assert.equal(digits, '5519912345678')
})

test('número local (sem DDI) recebe 55 automaticamente', () => {
  const { digits, notes } = normalizeBrPhoneNumber('19912345678')
  assert.equal(digits, '5519912345678')
  assert.ok(notes.some((n) => n.includes('55')))
})

test('prefixo de tronco 0 é removido', () => {
  const { digits } = normalizeBrPhoneNumber('019912345678')
  assert.equal(digits, '5519912345678')
})

test('número fixo (10 dígitos locais) é aceito com aviso', () => {
  const { digits, notes } = normalizeBrPhoneNumber('551934567890')
  assert.equal(digits, '551934567890')
  assert.ok(notes.some((n) => n.includes('fixo')))
})

test('formatos ambíguos são recusados', () => {
  assert.equal(normalizeBrPhoneNumber('123456789').digits, null) // tamanho fora do padrão
  assert.equal(normalizeBrPhoneNumber('551991234567').digits, null) // celular sem o nono dígito
  assert.equal(normalizeBrPhoneNumber('5519345678901').digits, null) // 11 dígitos sem começar em 9
  assert.equal(normalizeBrPhoneNumber('34612345678').digits, null) // DDI estrangeiro
  assert.equal(normalizeBrPhoneNumber('').digits, null)
  assert.equal(normalizeBrPhoneNumber(null).digits, null)
})

test('cooldown do limite de tentativas escala até o teto de 1h', () => {
  const first = nextRateLimitCooldownMs(0)
  assert.equal(first, 5 * 60 * 1000)
  assert.equal(nextRateLimitCooldownMs(first), 15 * 60 * 1000)
  assert.equal(nextRateLimitCooldownMs(15 * 60 * 1000), 45 * 60 * 1000)
  assert.equal(nextRateLimitCooldownMs(45 * 60 * 1000), 60 * 60 * 1000)
  assert.equal(nextRateLimitCooldownMs(60 * 60 * 1000), 60 * 60 * 1000)
})
