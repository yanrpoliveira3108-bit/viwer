/**
 * @file src/utils/time.js
 * @module utils/time
 *
 * Utilitários de tempo: formatação de duração e data/hora.
 */

/**
 * Formata duração (ms) como `1d 02:03:04`.
 * @param {number} ms Duração em milissegundos.
 * @returns {string} Duração legível.
 */
export function formatUptime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const hhmmss = [hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':')
  return days > 0 ? `${days}d ${hhmmss}` : hhmmss
}

/**
 * Hora local `HH:MM:SS`.
 * @param {Date} [date] Data (padrão: agora).
 * @returns {string} Hora formatada.
 */
export function formatClock(date = new Date()) {
  return date.toLocaleTimeString('pt-BR', { hour12: false })
}

/**
 * Data e hora local `AAAA-MM-DD HH:MM:SS` (segura para nomes de arquivo).
 * @param {Date} [date] Data (padrão: agora).
 * @returns {string} Data formatada.
 */
export function formatDateTime(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

/**
 * Timestamp compacto para nomes de backup: `AAAAMDD-HHMMSS`.
 * @param {Date} [date] Data (padrão: agora).
 * @returns {string} Timestamp.
 */
export function compactTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

/**
 * Aguarda um intervalo sem bloquear o event loop.
 * @param {number} ms Milissegundos.
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
