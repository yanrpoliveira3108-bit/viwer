/**
 * @file src/utils/fs.js
 * @module utils/fs
 *
 * Utilitários de sistema de arquivos: diretórios, escrita atômica e
 * arquivos temporários. Usa apenas recursos nativos do Node.js.
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

/**
 * Garante que um diretório exista (criação recursiva).
 * @param {string} dir Caminho do diretório.
 * @returns {Promise<void>}
 */
export async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true })
}

/** Versão síncrona de {@link ensureDir}. */
export function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

/**
 * Verifica se um caminho existe.
 * @param {string} target Caminho.
 * @returns {Promise<boolean>}
 */
export async function exists(target) {
  try {
    await fsp.access(target)
    return true
  } catch {
    return false
  }
}

/**
 * Escrita atômica: grava em arquivo temporário e renomeia.
 * Evita corrupção em caso de queda de energia/energia/processo.
 *
 * @param {string} file Caminho final.
 * @param {string|Buffer} data Conteúdo.
 * @returns {Promise<void>}
 */
export async function atomicWrite(file, data) {
  const dir = path.dirname(file)
  await ensureDir(dir)
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`)
  await fsp.writeFile(tmp, data)
  await fsp.rename(tmp, file)
}

/**
 * Cria um arquivo temporário único dentro de um diretório.
 * @param {string} dir Diretório base (será criado se necessário).
 * @param {string} prefix Prefixo do nome.
 * @param {string} ext Extensão (com ponto).
 * @returns {Promise<string>} Caminho absoluto do arquivo temporário.
 */
export async function createTempFile(dir, prefix, ext) {
  await ensureDir(dir)
  const name = `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`
  return path.join(dir, name)
}

/**
 * Remove um arquivo ignorando erros (idempotente).
 * @param {string} file Caminho.
 * @returns {Promise<void>}
 */
export async function removeSilently(file) {
  try {
    await fsp.unlink(file)
  } catch {
    /* já removido ou inacessível — nada a fazer */
  }
}

/**
 * Espaço livre em bytes para o volume de um caminho.
 * Requer Node.js >= 19.6 (fs.statfs).
 * @param {string} target Caminho de referência.
 * @returns {Promise<{free: number, total: number}|null>}
 */
export async function diskSpace(target) {
  try {
    const stats = await fsp.statfs(target)
    return { free: stats.bavail * stats.bsize, total: stats.blocks * stats.bsize }
  } catch {
    return null
  }
}
