/**
 * @file test/baileys-adapter.test.js
 * O servidor do WhatsApp exige o campo `version` no DeviceProps do registro
 * para aceitar sessões de Pairing Code; o fork congelado não o envia, então
 * o adaptador injeta o campo. Este teste trava esse comportamento.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { getBaileys } from '../src/lib/baileys.js'

const require = createRequire(import.meta.url)

test('registro recebe a versão do acompanhante exigida pelo servidor', () => {
  const api = getBaileys()
  const validateModule = require('@lucasmod/boruto-vk7-baileys/baileys/lib/Utils/validate-connection.js')
  const Utils = require('@lucasmod/boruto-vk7-baileys/baileys/lib/Utils/index.js')

  // O Socket resolve a função pelo barrel em tempo de chamada.
  assert.equal(Utils.generateRegistrationNode, validateModule.generateRegistrationNode)

  const node = Utils.generateRegistrationNode(
    {
      registrationId: 1,
      signedPreKey: {
        keyId: 1,
        keyPair: { public: Buffer.alloc(32) },
        signature: Buffer.alloc(64),
      },
      signedIdentityKey: { public: Buffer.alloc(32) },
    },
    {
      version: [2, 3000, 1043857760],
      browser: ['Ubuntu', 'Chrome', '120.0.0'],
      syncFullHistory: false,
      countryCode: 'BR',
    }
  )

  const props = api.proto.DeviceProps.decode(node.devicePairingData.deviceProps)
  assert.deepEqual(
    {
      primary: props.version.primary,
      secondary: props.version.secondary,
      tertiary: props.version.tertiary,
    },
    { primary: 10, secondary: 15, tertiary: 7 }
  )
  assert.equal(props.os, 'Ubuntu')
})
