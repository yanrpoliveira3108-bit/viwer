/**
 * @file src/updater/migrations.js
 * @module updater/migrations
 *
 * Migrações automáticas executadas durante atualizações.
 *
 * Cada migração declara a versão em que deve ser aplicada e uma função
 * `up()` idempotente. O executor roda apenas migrações entre a versão
 * instalada (antes do update) e a versão de destino, em ordem.
 *
 * Migrações NUNCA removem dados do usuário: apenas criam estruturas novas,
 * convertem formatos ou adicionam entradas de configuração com padrão.
 */

import fs from 'node:fs'
import path from 'node:path'
import { ROOT_DIR } from '../constants.js'
import { compareSemver } from '../utils/semver.js'
import { ensureDirSync } from '../utils/fs.js'

/**
 * Registro de migrações.
 * @type {{version: string, name: string, up: (ctx: object) => void}[]}
 */
export const migrations = [
  {
    version: '1.0.0',
    name: 'baseline: diretórios do usuário',
    up: () => {
      for (const dir of ['session', 'data', 'logs', 'backups', 'tmp', 'plugins']) {
        ensureDirSync(path.join(ROOT_DIR, dir))
      }
    },
  },
]

/**
 * Executa migrações pendentes entre duas versões.
 *
 * @param {object} options Opções.
 * @param {string} options.fromVersion Versão instalada antes do update.
 * @param {string} options.toVersion Versão de destino.
 * @param {(message: string) => void} [options.log] Callback de registro.
 * @returns {number} Quantidade de migrações executadas.
 */
export function runMigrations({ fromVersion, toVersion, log = () => {} }) {
  const pending = migrations
    .filter((migration) => {
      const afterFrom = compareSemver(migration.version, fromVersion) > 0
      const upToTarget = compareSemver(migration.version, toVersion) <= 0
      return afterFrom && upToTarget
    })
    .sort((a, b) => compareSemver(a.version, b.version))

  for (const migration of pending) {
    log(`migração ${migration.version}: ${migration.name}`)
    migration.up({ root: ROOT_DIR, fs, path })
  }
  return pending.length
}
