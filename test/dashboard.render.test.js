/**
 * Teste de renderização do Dashboard sem terminal real.
 * Captura a saída escrita e valida que o quadro é produzido sem erros.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { Dashboard } from '../src/terminal/Dashboard.js'
import { Stats } from '../src/stats/Stats.js'
import { Database } from '../src/database/Database.js'

function makeStubs() {
  const db = new Database({ file: '/tmp/viewer-dash-test.json', saveIntervalMs: 100000 })
  const stats = new Stats({ db, persist: false })
  stats.messageProcessed()
  stats.mediaRecovered('image', 1234)

  const config = {
    get: (key) =>
      ({
        'viewer.theme': 'default',
        'dashboard.logLines': 4,
        'dashboard.enabled': true,
        'dashboard.refreshMs': 100000,
        'update.channel': 'stable',
      })[key],
  }
  const connection = {
    getStatus: () => ({ state: 'open' }),
    waVersion: '2.3000.0',
  }
  const cache = { size: 2 }
  return { config, connection, stats, cache }
}

test('render produz quadro completo sem exceções', () => {
  const originalWrite = process.stdout.write
  const chunks = []
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk))
    return true
  }

  try {
    const dashboard = new Dashboard(makeStubs())
    dashboard.running = true // força render sem exigir TTY
    dashboard.render()
    dashboard.render() // segundo quadro (caminho de sobrescrita)
    dashboard.timer = null
    dashboard.stop()
  } finally {
    process.stdout.write = originalWrite
  }

  const frame = chunks.join('')
  assert.ok(frame.includes('Viewer'), 'marca presente')
  assert.ok(frame.includes('CONEXÃO'), 'caixa de conexão presente')
  assert.ok(frame.includes('SISTEMA'), 'caixa de sistema presente')
  assert.ok(frame.includes('RECURSOS'), 'caixa de recursos presente')
  assert.ok(frame.includes('ATIVIDADE'), 'caixa de atividade presente')
  assert.ok(frame.includes('REGISTROS'), 'caixa de registros presente')
  assert.ok(frame.includes('1'), 'contador de mídia recuperada presente')
})

test('código de pareamento aparece no painel e some ao conectar', () => {
  const originalWrite = process.stdout.write
  const chunks = []
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk))
    return true
  }

  try {
    const dashboard = new Dashboard(makeStubs())
    dashboard.running = true

    dashboard.pairingCode = 'ABCD-1234'
    dashboard.render()
    const withCode = chunks.join('')
    assert.ok(withCode.includes('ABCD-1234'), 'código exibido na caixa de conexão')
    assert.ok(withCode.includes('Onde digitar'), 'instrução de pareamento exibida')

    chunks.length = 0
    dashboard.pairingCode = null // conexão confirmada
    dashboard.render()
    assert.ok(!chunks.join('').includes('ABCD-1234'), 'código removido após confirmar')

    dashboard.timer = null
    dashboard.stop()
  } finally {
    process.stdout.write = originalWrite
  }
})
