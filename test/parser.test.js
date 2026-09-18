/**
 * Testes do parser de mensagens (formato interno do Viewer).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMessage, isGroupJid } from '../src/viewer/parser.js'

test('mensagem comum é normalizada', () => {
  const parsed = parseMessage({
    key: { remoteJid: '5511@s.whatsapp.net', id: 'ABC', fromMe: false },
    messageTimestamp: 1700000000,
    message: { conversation: 'olá' },
  })
  assert.equal(parsed.id, 'ABC')
  assert.equal(parsed.remoteJid, '5511@s.whatsapp.net')
  assert.equal(parsed.fromMe, false)
  assert.equal(parsed.quoted, null)
  assert.equal(parsed.reaction, null)
})

test('resposta extrai contexto da citada', () => {
  const parsed = parseMessage({
    key: { remoteJid: 'grupo@g.us', id: 'R1', fromMe: true, participant: 'me@s.whatsapp.net' },
    messageTimestamp: 1700000000,
    message: {
      extendedTextMessage: {
        text: 're',
        contextInfo: {
          stanzaId: 'VO123',
          participant: 'autor@s.whatsapp.net',
          quotedMessage: { viewOnceMessage: { message: { imageMessage: { url: 'u', mediaKey: 'k' } } } },
        },
      },
    },
  })
  assert.ok(parsed.quoted)
  assert.equal(parsed.quoted.stanzaId, 'VO123')
  assert.equal(parsed.quoted.participant, 'autor@s.whatsapp.net')
  assert.ok(parsed.quoted.content.viewOnceMessage)
})

test('reação extrai chave da mensagem reagida', () => {
  const parsed = parseMessage({
    key: { remoteJid: '5511@s.whatsapp.net', id: 'R2', fromMe: true },
    messageTimestamp: 1700000000,
    message: {
      reactionMessage: {
        key: { remoteJid: '5511@s.whatsapp.net', id: 'ALVO', fromMe: false },
        text: '🔥',
      },
    },
  })
  assert.ok(parsed.reaction)
  assert.equal(parsed.reaction.targetKey.id, 'ALVO')
  assert.equal(parsed.reaction.emoji, '🔥')
})

test('mensagens inválidas retornam null', () => {
  assert.equal(parseMessage(null), null)
  assert.equal(parseMessage({ key: {}, message: {} }), null)
  assert.equal(parseMessage({ key: { remoteJid: 'x' }, message: {} }), null)
})

test('isGroupJid distingue grupos', () => {
  assert.equal(isGroupJid('abc@g.us'), true)
  assert.equal(isGroupJid('5511@s.whatsapp.net'), false)
  assert.equal(isGroupJid(null), false)
})
