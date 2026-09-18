/**
 * @file test/baileys-patches.test.js
 * O pareamento por código depende dos patches aplicados na biblioteca
 * instalada (mudança de protocolo do WhatsApp em 07/2026 — Baileys #2602
 * e #2765). Estes testes travam a aplicação idempotente e a carga.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { applyPairingSourcePatches, PATCH_MARKERS } from '../src/lib/baileys-patches.js'
import { getBaileys } from '../src/lib/baileys.js'

const require = createRequire(import.meta.url)

test('patches de pareamento aplicados (ou já presentes) e biblioteca carrega', () => {
  const result = applyPairingSourcePatches((id) => require.resolve(id))
  assert.equal(result.failed.length, 0)
  // Idempotência: tudo já aplicado ou aplicado agora.
  assert.equal(result.patched.length + result.skipped.length, 2)

  const api = getBaileys()
  assert.ok(typeof api === 'object' && api !== null)
})

test('marcadores presentes nos arquivos patcheados', () => {
  const base = require.resolve('@lucasmod/boruto-vk7-baileys/package.json')
  const candidates = ['baileys/lib', 'lib']
  let messagesRecv = null
  let socket = null
  for (const layout of candidates) {
    const mr = `${base.replace(/package\.json$/, '')}${layout}/Socket/messages-recv.js`
    const sk = `${base.replace(/package\.json$/, '')}${layout}/Socket/socket.js`
    if (fs.existsSync(mr) && fs.existsSync(sk)) {
      messagesRecv = mr
      socket = sk
      break
    }
  }
  assert.ok(messagesRecv && socket, 'arquivos da biblioteca localizados')
  assert.ok(fs.readFileSync(messagesRecv, 'utf8').includes(PATCH_MARKERS.guard))
  assert.ok(fs.readFileSync(socket, 'utf8').includes(PATCH_MARKERS.refresh))
})
