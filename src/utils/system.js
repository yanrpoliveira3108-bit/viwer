/**
 * @file src/utils/system.js
 * @module utils/system
 *
 * Métricas de recursos do processo (CPU e memória).
 *
 * Privacidade: coleta apenas números agregados do próprio processo.
 * Nunca consulta nem expõe IP, hostname, MAC, IMEI, GPS, operadora ou
 * qualquer identificador do aparelho.
 */

import os from 'node:os'

/** Estado interno do medidor de CPU (diferenças entre amostras). */
const cpuState = { last: process.cpuUsage(), at: process.hrtime.bigint() }

/**
 * Uso de CPU do processo desde a última chamada, em porcentagem.
 * Um núcleo totalmente ocupado corresponde a 100%.
 *
 * @returns {number} Percentual (0..100*cpus), arredondado a 1 decimal.
 */
export function sampleProcessCpu() {
  const now = process.cpuUsage()
  const at = process.hrtime.bigint()
  const elapsedUs = Number(at - cpuState.at) / 1000
  const usedUs = now.user - cpuState.last.user + (now.system - cpuState.last.system)
  cpuState.last = now
  cpuState.at = at
  if (elapsedUs <= 0) return 0
  return Math.round((usedUs / elapsedUs) * 1000) / 10
}

/**
 * Memória utilizada pelo processo (RSS), em bytes.
 * @returns {number} Bytes.
 */
export function processMemory() {
  return process.memoryUsage().rss
}

/**
 * Informações básicas e NÃO identificáveis da plataforma.
 * @returns {string} Descrição curta (ex.: `Android/Termux`, `Linux`).
 */
export function platformLabel() {
  if (process.env.PREFIX && process.env.PREFIX.includes('com.termux')) {
    return 'Android/Termux'
  }
  if (process.platform === 'android') return 'Android'
  switch (process.platform) {
    case 'linux':
      return 'Linux'
    case 'darwin':
      return 'macOS'
    case 'win32':
      return 'Windows'
    default:
      return process.platform
  }
}

/**
 * Memória livre do sistema (informativa), em bytes.
 * @returns {number} Bytes.
 */
export function systemFreeMemory() {
  return os.freemem()
}

/**
 * Memória total do sistema (informativa), em bytes.
 * @returns {number} Bytes.
 */
export function systemTotalMemory() {
  return os.totalmem()
}
