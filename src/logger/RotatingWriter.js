/**
 * @file src/logger/RotatingWriter.js
 * @module logger/RotatingWriter
 *
 * Escritor de arquivo com rotação automática por tamanho.
 * Implementação nativa e leve: escrita síncrona (volume de logs é baixo)
 * com renomeamento em cascata `viewer.log → viewer.1.log → ...`.
 */

import fs from 'node:fs'
import path from 'node:path'
import { ensureDirSync } from '../utils/fs.js'

export class RotatingWriter {
  /**
   * @param {object} options Opções.
   * @param {string} options.dir Diretório dos arquivos de log.
   * @param {string} [options.baseName='viewer'] Nome base do arquivo.
   * @param {number} [options.maxBytes=5242880] Tamanho máximo (5 MB).
   * @param {number} [options.maxFiles=5] Quantidade de arquivos mantidos.
   */
  constructor({ dir, baseName = 'viewer', maxBytes = 5 * 1024 * 1024, maxFiles = 5 }) {
    this.dir = dir
    this.baseName = baseName
    this.maxBytes = maxBytes
    this.maxFiles = Math.max(1, maxFiles)
    this.file = path.join(dir, `${baseName}.log`)
    this.bytes = 0
    this.ready = false
  }

  /** Prepara diretório e mede o tamanho atual do arquivo ativo. */
  open() {
    try {
      ensureDirSync(this.dir)
      this.bytes = fs.existsSync(this.file) ? fs.statSync(this.file).size : 0
      this.ready = true
    } catch {
      // Sem permissão/disco: o Viewer continua apenas com logs em tela.
      this.ready = false
    }
  }

  /**
   * Grava uma linha, rotacionando quando necessário.
   * @param {string} line Linha já formatada (com quebra ao final).
   */
  write(line) {
    if (!this.ready) return
    try {
      const data = Buffer.from(line, 'utf8')
      if (this.bytes + data.length > this.maxBytes) this.#rotate()
      fs.appendFileSync(this.file, data)
      this.bytes += data.length
    } catch {
      /* falha de disco jamais derruba o Viewer */
    }
  }

  /** Rotação em cascata: remove o mais antigo e desloca os demais. */
  #rotate() {
    try {
      const name = (i) => path.join(this.dir, `${this.baseName}.${i}.log`)
      fs.rmSync(name(this.maxFiles - 1), { force: true })
      for (let i = this.maxFiles - 2; i >= 1; i -= 1) {
        if (fs.existsSync(name(i))) fs.renameSync(name(i), name(i + 1))
      }
      if (fs.existsSync(this.file)) fs.renameSync(this.file, name(1))
      this.bytes = 0
    } catch {
      /* mantém o arquivo atual se a rotação falhar */
    }
  }

  /** Fecha o escritor (logs futuros são descartados silenciosamente). */
  close() {
    this.ready = false
  }
}
