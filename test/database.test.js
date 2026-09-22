/**
 * Testes do banco de dados JSON e das estatísticas.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Database } from '../src/database/Database.js'
import { Stats } from '../src/stats/Stats.js'

function tempDbFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-test-')), 'db.json')
}

test('set/flush/load preserva dados', async () => {
  const file = tempDbFile()
  const db = new Database({ file, saveIntervalMs: 100000 })
  await db.load()
  db.set('stats', 'x', { a: 1 })
  db.flush()
  db.close()

  const db2 = new Database({ file, saveIntervalMs: 100000 })
  await db2.load()
  assert.deepEqual(db2.get('stats', 'x'), { a: 1 })
  assert.equal(db2.get('stats', 'ausente', 42), 42)
  db2.close()
})

test('banco corrompido é isolado sem lançar', async () => {
  const file = tempDbFile()
  fs.writeFileSync(file, '{ quebrado')
  const db = new Database({ file, saveIntervalMs: 100000 })
  await db.load()
  assert.deepEqual(db.getNamespace('stats'), {})
  const isolated = fs.readdirSync(path.dirname(file)).some((f) => f.includes('.corrupt-'))
  assert.equal(isolated, true)
  db.close()
})

test('stats conta recuperações por tipo e média', () => {
  const file = tempDbFile()
  const db = new Database({ file, saveIntervalMs: 100000 })
  const stats = new Stats({ db, persist: false })

  stats.messageProcessed()
  stats.mediaRecovered('image', 1000)
  stats.mediaRecovered('sticker', 3000)
  stats.mediaRecovered('tipoestranho', 500) // cai para "other"
  stats.error()
  stats.skipped()
  stats.duplicateBlocked()

  const snap = stats.snapshot()
  assert.equal(snap.session.messagesProcessed, 1)
  assert.equal(snap.session.mediaRecovered, 3)
  assert.equal(snap.session.byType.image, 1)
  assert.equal(snap.session.byType.sticker, 1)
  assert.equal(snap.session.byType.other, 1)
  assert.equal(snap.session.errors, 1)
  assert.equal(snap.avgRecoveryMs, 1500)
  db.close()
})

test('stats persistidas são restauradas', () => {
  const file = tempDbFile()
  const db = new Database({ file, saveIntervalMs: 100000 })
  const stats = new Stats({ db, persist: true })
  stats.mediaRecovered('video', 2000)
  db.flush()

  const db2 = new Database({ file, saveIntervalMs: 100000 })
  void db2.load()
  const stats2 = new Stats({ db: db2, persist: true })
  assert.equal(stats2.total.mediaRecovered, 1)
  assert.equal(stats2.total.byType.video, 1)
  db.close()
  db2.close()
})
