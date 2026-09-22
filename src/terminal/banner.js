/**
 * @file src/terminal/banner.js
 * @module terminal/banner
 *
 * Etapas de inicialização exibidas antes do Dashboard assumir a tela.
 * Cada etapa é registrada também no log para auditoria.
 */

import { color } from '../utils/text.js'
import { formatClock } from '../utils/time.js'

/**
 * Exibe uma etapa da sequência de inicialização.
 * @param {string} step Descrição da etapa.
 * @param {'pending'|'done'|'warn'|'fail'} [state='done'] Estado visual.
 */
export function announce(step, state = 'done') {
  const icons = { pending: '…', done: '✓', warn: '!', fail: '✗' }
  const paints = {
    pending: color.dim,
    done: color.green,
    warn: color.yellow,
    fail: color.red,
  }
  const icon = paints[state](icons[state])
  process.stdout.write(`${color.gray(formatClock())} ${icon} ${step}\n`)
}
