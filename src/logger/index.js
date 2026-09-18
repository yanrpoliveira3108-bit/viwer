/**
 * @file src/logger/index.js
 * @module logger
 *
 * Sistema de logs do Viewer.
 *
 * - Níveis: DEBUG < INFO < WARN < ERROR (DEBUG desativado por padrão).
 * - Formato: `[HH:MM:SS] [MÓDULO] [NÍVEL] mensagem`.
 * - Sinks: console (quando o Dashboard não é dono da tela) e arquivo com
 *   rotação automática (tamanho e quantidade configuráveis).
 * - Todo registro é reemitido no barramento (`log:entry`) para que o
 *   Dashboard e futuros consumidores exibam os logs sem acoplamento.
 *
 * Privacidade: os logs nunca devem conter IP, localização ou identificadores
 * do aparelho. Este módulo não coleta nada além do que recebe dos chamadores.
 */

import { RotatingWriter } from './RotatingWriter.js'
import { bus } from '../core/EventBus.js'
import { EVENTS } from '../constants.js'
import { formatClock } from '../utils/time.js'

export const LogLevel = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40, silent: 99 })

/** Estado compartilhado do logger (singleton por processo). */
const state = {
  level: LogLevel.info,
  writer: null,
  consoleSink: true,
  counts: { debug: 0, info: 0, warn: 0, error: 0 },
}

/**
 * Configura o logger a partir da configuração central.
 *
 * @param {object} logConfig Seção `logs` da configuração.
 * @param {string} logConfig.level Nível mínimo (`debug|info|warn|error|silent`).
 * @param {boolean} logConfig.fileEnabled Ativa escrita em arquivo.
 * @param {string} logConfig.dir Diretório dos arquivos.
 * @param {number} logConfig.maxFileSizeMB Tamanho máximo por arquivo.
 * @param {number} logConfig.maxFiles Quantidade de arquivos mantidos.
 */
export function configureLogger(logConfig) {
  state.level = LogLevel[logConfig.level] ?? LogLevel.info
  if (logConfig.fileEnabled) {
    state.writer = new RotatingWriter({
      dir: logConfig.dir,
      maxBytes: logConfig.maxFileSizeMB * 1024 * 1024,
      maxFiles: logConfig.maxFiles,
    })
    state.writer.open()
  }
}

/**
 * Nível mínimo atual (para uso do Dashboard/tests).
 * @returns {number}
 */
export function getLevel() {
  return state.level
}

/**
 * Altera o nível mínimo em tempo de execução (futuro menu interativo).
 * @param {string} name Nome do nível.
 */
export function setLevelByName(name) {
  if (LogLevel[name] !== undefined) state.level = LogLevel[name]
}

/**
 * Ativa/desativa a saída no console.
 * O Dashboard desativa enquanto renderiza para não corromper a tela.
 * @param {boolean} enabled Estado desejado.
 */
export function setConsoleSink(enabled) {
  state.consoleSink = enabled
}

/**
 * Contadores por nível (usados pelo Dashboard e estatísticas).
 * @returns {{debug:number, info:number, warn:number, error:number}}
 */
export function getLogCounts() {
  return { ...state.counts }
}

/**
 * Escreve uma entrada de log. Uso interno — prefira `createLogger`.
 *
 * @param {string} module Módulo responsável.
 * @param {string} level Nível (`debug|info|warn|error`).
 * @param {string} message Mensagem já segura (sem dados sensíveis).
 */
function write(module, level, message) {
  if (LogLevel[level] < state.level) return
  state.counts[level] += 1

  const ts = formatClock()
  const line = `[${ts}] [${module}] [${level.toUpperCase()}] ${message}`

  state.writer?.write(line + '\n')
  bus.emit(EVENTS.LOG_ENTRY, { ts, module, level, message, line })

  if (state.consoleSink) {
    // stdout para info/debug, stderr para warn/error (bom comportamento Unix).
    const stream = level === 'warn' || level === 'error' ? process.stderr : process.stdout
    stream.write(line + '\n')
  }
}

/**
 * Cria um logger nomeado para um módulo.
 *
 * @param {string} module Nome do módulo responsável (ex.: `CONEXÃO`).
 * @returns {{debug: Function, info: Function, warn: Function, error: Function}}
 */
export function createLogger(module) {
  const scope = module.toUpperCase()
  return {
    debug: (msg) => write(scope, 'debug', msg),
    info: (msg) => write(scope, 'info', msg),
    warn: (msg) => write(scope, 'warn', msg),
    error: (msg) => write(scope, 'error', msg),
  }
}

/** Encerra o escritor de arquivo (chamado no shutdown). */
export function closeLogger() {
  state.writer?.close()
}
