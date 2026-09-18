/**
 * @file src/updater/backup.js
 * @module updater/backup
 *
 * Backup e restauração dos arquivos do usuário, usados pelo sistema de
 * atualização (e disponíveis para o futuro backup manual).
 *
 * Cada backup é uma pasta `backups/AAAA-MM-DD-HHMMSS-vVERSÃO/` contendo:
 * sessão, banco de dados, configurações e um `meta.json` com data, hora,
 * versão de origem e identificação da operação — o suficiente p/ rollback.
 */

import fs from 'node:fs'
import path from 'node:path'
import { ROOT_DIR, APP_VERSION } from '../constants.js'
import { ensureDirSync } from '../utils/fs.js'
import { compactTimestamp } from '../utils/time.js'
import { PROTECTED_PATHS } from '../config/defaults.js'

/** Itens do usuário protegidos por backup (relativos à raiz). */
const BACKUP_TARGETS = ['session', 'data', 'logs', 'viewer.config.json', 'plugins']

/**
 * Lista os itens protegidos que existem atualmente.
 * @returns {string[]} Caminhos relativos existentes.
 * @param {string} [root] Raiz do projeto.
 */
export function existingProtected(root = ROOT_DIR) {
  return BACKUP_TARGETS.filter((item) => fs.existsSync(path.join(root, item)))
}

/**
 * Cria um backup completo dos dados do usuário.
 *
 * @param {object} options Opções.
 * @param {string} options.backupDir Diretório raiz dos backups (absoluto).
 * @param {string} [options.toVersion] Versão de destino da operação.
 * @returns {{dir: string, items: string[]}} Pasta criada e itens copiados.
 */
export function createBackup({ backupDir, toVersion = APP_VERSION }) {
  const when = new Date()
  const name = `${compactTimestamp(when)}-v${toVersion}`
  const dir = path.join(backupDir, name)
  ensureDirSync(dir)

  const items = []
  for (const item of existingProtected()) {
    const source = path.join(ROOT_DIR, item)
    const target = path.join(dir, item)
    fs.cpSync(source, target, { recursive: true, force: false, errorOnExist: false })
    items.push(item)
  }

  const meta = {
    createdAt: when.toISOString(),
    date: when.toLocaleDateString('pt-BR'),
    time: when.toLocaleTimeString('pt-BR'),
    fromVersion: APP_VERSION,
    toVersion,
    origin: 'viewer-update',
    items,
  }
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
  return { dir, items }
}

/**
 * Lista backups existentes, do mais recente para o mais antigo.
 * @param {string} backupDir Diretório raiz dos backups.
 * @returns {{dir: string, meta: object|null}[]}
 */
export function listBackups(backupDir) {
  if (!fs.existsSync(backupDir)) return []
  return fs
    .readdirSync(backupDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(backupDir, entry.name)
      let meta = null
      try {
        meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'))
      } catch {
        /* backup sem metadados ainda é restaurável */
      }
      return { dir, meta }
    })
    .sort((a, b) => path.basename(b.dir).localeCompare(path.basename(a.dir)))
}

/**
 * Restaura um backup sobre a instalação atual.
 * @param {string} backupDirEntry Pasta do backup (contém meta.json).
 */
export function restoreBackup(backupDirEntry) {
  // Restaura exatamente os itens registrados no meta.json (ou todos).
  let meta = null
  try {
    meta = JSON.parse(fs.readFileSync(path.join(backupDirEntry, 'meta.json'), 'utf8'))
  } catch {
    /* sem meta: restaura a lista completa conhecida */
  }
  const items = Array.isArray(meta?.items) && meta.items.length > 0 ? meta.items : BACKUP_TARGETS

  for (const item of items) {
    const source = path.join(backupDirEntry, item)
    if (!fs.existsSync(source)) continue
    const target = path.join(ROOT_DIR, item)
    fs.rmSync(target, { recursive: true, force: true })
    fs.cpSync(source, target, { recursive: true })
  }
}

/**
 * Remove backups antigos conforme a política configurada.
 * @param {string} backupDir Diretório raiz dos backups.
 * @param {number} keep Quantidade de backups a manter.
 */
export function pruneBackups(backupDir, keep) {
  const backups = listBackups(backupDir)
  for (const old of backups.slice(Math.max(0, keep))) {
    fs.rmSync(old.dir, { recursive: true, force: true })
  }
}

/**
 * @param {string} candidate Caminho relativo.
 * @returns {boolean} `true` se é um caminho protegido do usuário.
 */
export function isProtectedPath(candidate) {
  const first = String(candidate).split('/')[0]
  return PROTECTED_PATHS.includes(first) || PROTECTED_PATHS.includes(candidate)
}
