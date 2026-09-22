/**
 * @file src/database/Database.js
 * @module database
 *
 * Banco de dados do Viewer: armazenamento JSON simples, rápido e sem
 * dependências externas, com escrita atômica e persistência agrupada
 * (menos operações de disco).
 *
 * Todo acesso passa exclusivamente por esta classe — nenhum módulo
 * manipula o arquivo diretamente. Novas coleções são criadas sob demanda,
 * preparando expansões futuras sem migração manual.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createLogger } from '../logger/index.js'

const log = createLogger('BANCO')

export class Database {
  /**
   * @param {object} options Opções.
   * @param {string} options.file Caminho absoluto do arquivo JSON.
   * @param {number} [options.saveIntervalMs=30000] Intervalo de persistência.
   */
  constructor({ file, saveIntervalMs = 30000 }) {
    this.file = file
    this.saveIntervalMs = saveIntervalMs
    /** @type {Record<string, Record<string, unknown>>} */
    this.data = {}
    this.dirty = false
    this.timer = null
  }

  /**
   * Carrega o banco. Arquivo corrompido é preservado como `.corrupt` e o
   * Viewer inicia com banco vazio (nunca falha a inicialização).
   * @returns {Promise<void>}
   */
  async load() {
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'))
        if (parsed && typeof parsed === 'object') {
          this.data = parsed
          log.info('banco de dados carregado')
          return
        }
        log.warn('banco com formato inesperado → reiniciado')
      }
    } catch (error) {
      const backup = `${this.file}.corrupt-${Date.now()}`
      try {
        fs.copyFileSync(this.file, backup)
      } catch {
        /* sem permissão para preservar o arquivo corrompido */
      }
      log.warn(
        `banco corrompido (${error.message}) → cópia em ${path.basename(backup)}, iniciando vazio`
      )
    }
    this.data = {}
  }

  /** Inicia o ciclo de persistência agrupada. */
  start() {
    this.timer = setInterval(() => {
      if (this.dirty) this.flush()
    }, this.saveIntervalMs)
    this.timer.unref()
  }

  /**
   * Lê um valor.
   * @param {string} namespace Coleção (ex.: `stats`).
   * @param {string} key Chave.
   * @param {unknown} [fallback] Valor padrão quando ausente.
   * @returns {unknown}
   */
  get(namespace, key, fallback = undefined) {
    return this.data[namespace]?.[key] ?? fallback
  }

  /**
   * Lê uma coleção inteira (cópia).
   * @param {string} namespace Coleção.
   * @returns {object}
   */
  getNamespace(namespace) {
    return { ...(this.data[namespace] ?? {}) }
  }

  /**
   * Escreve um valor (marca como sujo; persistência no próximo ciclo).
   * @param {string} namespace Coleção.
   * @param {string} key Chave.
   * @param {unknown} value Valor serializável em JSON.
   */
  set(namespace, key, value) {
    if (!this.data[namespace]) this.data[namespace] = {}
    this.data[namespace][key] = value
    this.dirty = true
  }

  /** Persiste imediatamente se houver alterações pendentes. */
  flush() {
    if (!this.dirty) return
    try {
      // Escrita síncrona intencional: garante consistência no shutdown.
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2))
      fs.renameSync(tmp, this.file)
      this.dirty = false
    } catch (error) {
      log.error(`falha ao persistir banco: ${error.message}`)
    }
  }

  /** Encerra o banco com persistência final. */
  close() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.flush()
  }
}
