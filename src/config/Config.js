/**
 * @file src/config/Config.js
 * @module config
 *
 * Configuração central do Viewer.
 *
 * Regras:
 * - Fonte única de opções; nenhum módulo possui configuração interna.
 * - Arquivo do usuário separado do código (`viewer.config.json` na raiz).
 * - Ausência de chave  → valor padrão + aviso no log (nunca interrompe).
 * - Tipo errado        → valor padrão + aviso no log (nunca interrompe).
 * - Chaves novas em versões futuras são mescladas automaticamente.
 */

import fs from 'node:fs'
import path from 'node:path'
import { ROOT_DIR } from '../constants.js'
import { defaults, CONFIG_FILE_NAME, CONFIG_SAMPLE_NAME } from './defaults.js'
import { atomicWrite } from '../utils/fs.js'
import { createLogger } from '../logger/index.js'

const log = createLogger('CONFIG')

/**
 * Verifica se um valor é um objeto simples (não array/null).
 * @param {unknown} value Valor.
 * @returns {boolean}
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Mescla usuário sobre os padrões, validando tipos folha.
 * Registra avisos para chaves ausentes/inválidas (uma única vez por chave).
 *
 * @param {object} base Padrões.
 * @param {object} user Valores do usuário.
 * @param {string} prefix Caminho atual (para mensagens).
 * @param {(path: string, reason: string) => void} onIssue Callback de aviso.
 * @returns {object} Configuração final.
 */
function deepMerge(base, user, prefix, onIssue) {
  const out = {}
  for (const [key, defaultVal] of Object.entries(base)) {
    const fullPath = prefix ? `${prefix}.${key}` : key
    const userVal = isPlainObject(user) ? user[key] : undefined

    if (userVal === undefined) {
      onIssue(fullPath, 'ausente')
      // Cópia profunda: evita que mutações futuras alterem os padrões.
      out[key] = JSON.parse(JSON.stringify(defaultVal))
      continue
    }

    if (isPlainObject(defaultVal)) {
      out[key] = deepMerge(defaultVal, userVal, fullPath, onIssue)
      continue
    }

    const defaultType = Array.isArray(defaultVal) ? 'array' : typeof defaultVal
    const userType = Array.isArray(userVal) ? 'array' : typeof userVal
    if (defaultType !== userType) {
      onIssue(fullPath, `tipo esperado ${defaultType}, recebido ${userType}`)
      out[key] = defaultVal
    } else {
      out[key] = userVal
    }
  }
  return out
}

/**
 * Mescla valores do usuário sobre os padrões com validação (função pura,
 * exportada para testes e reuso).
 *
 * @param {object} base Padrões.
 * @param {object} user Valores do usuário.
 * @param {(path: string, reason: string) => void} [onIssue] Callback de aviso.
 * @returns {object} Configuração final.
 */
export function mergeConfig(base, user, onIssue = () => {}) {
  return deepMerge(base, user, '', onIssue)
}

/** Gerenciador de configuração (singleton criado em {@link loadConfig}). */
export class Config {
  /**
   * @param {object} values Configuração mesclada final.
   * @param {string} file Caminho do arquivo do usuário.
   * @param {string[]} issues Avisos gerados no carregamento.
   */
  constructor(values, file, issues) {
    this.values = values
    this.file = file
    this.issues = issues
  }

  /**
   * Lê um valor por caminho pontuado (ex.: `cache.maxEntries`).
   * @param {string} keyPath Caminho.
   * @returns {unknown} Valor (ou `undefined`).
   */
  get(keyPath) {
    let node = this.values
    for (const part of keyPath.split('.')) {
      node = node?.[part]
    }
    return node
  }

  /** @returns {object} Cópia rasa da configuração completa. */
  getAll() {
    return this.values
  }

  /**
   * Persiste a configuração atual no arquivo do usuário (menu futuro).
   * @returns {Promise<void>}
   */
  async save() {
    await atomicWrite(this.file, JSON.stringify(this.values, null, 2) + '\n')
  }

  /**
   * Resolve um caminho relativo à raiz do projeto.
   * @param {string} relative Caminho relativo vindo da configuração.
   * @returns {string} Caminho absoluto.
   */
  resolvePath(relative) {
    return path.isAbsolute(relative) ? relative : path.join(ROOT_DIR, relative)
  }
}

/**
 * Carrega a configuração do Viewer.
 * Se o arquivo do usuário não existir, cria a partir do modelo (se houver)
 * ou dos padrões — sempre com aviso, nunca com falha.
 *
 * @returns {Promise<Config>} Configuração pronta para uso.
 */
export async function loadConfig() {
  const file = path.join(ROOT_DIR, CONFIG_FILE_NAME)
  const issues = []
  let user = {}

  const onIssue = (keyPath, reason) => {
    issues.push(`${keyPath}: ${reason}`)
    log.warn(`config.${keyPath} — ${reason} → usando padrão`)
  }

  try {
    if (!fs.existsSync(file)) {
      const sample = path.join(ROOT_DIR, CONFIG_SAMPLE_NAME)
      const seed = fs.existsSync(sample)
        ? fs.readFileSync(sample, 'utf8')
        : JSON.stringify(defaults, null, 2)
      await atomicWrite(file, seed.endsWith('\n') ? seed : seed + '\n')
      log.info(`arquivo de configuração criado em ${CONFIG_FILE_NAME}`)
    }
    user = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!isPlainObject(user)) {
      log.warn('arquivo de configuração inválido (não é um objeto) → usando padrões')
      user = {}
    }
  } catch (error) {
    log.warn(`falha ao ler configuração (${error.message}) → usando padrões`)
    user = {}
  }

  const values = deepMerge(defaults, user, '', onIssue)
  const config = new Config(values, file, issues)
  log.info('configuração carregada')
  return config
}
