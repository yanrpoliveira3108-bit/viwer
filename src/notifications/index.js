/**
 * @file src/notifications/index.js
 * @module notifications
 *
 * Central de notificações internas (estrutura preparada).
 *
 * Qualquer módulo pode publicar uma notificação; consumidores atuais e
 * futuros (menu, painel, plugins) assinam o evento `notification:new`.
 *
 * Tipos previstos: nova versão disponível, erro crítico, banco corrompido,
 * espaço insuficiente, sessão expirada, atualização concluída.
 */

import { bus } from '../core/EventBus.js'
import { EVENTS } from '../constants.js'
import { createLogger } from '../logger/index.js'

const log = createLogger('NOTIF')

/** Tipos oficiais de notificação. */
export const NotificationType = Object.freeze({
  NEW_VERSION: 'new-version',
  CRITICAL_ERROR: 'critical-error',
  DATABASE_CORRUPTED: 'database-corrupted',
  LOW_DISK_SPACE: 'low-disk-space',
  SESSION_EXPIRED: 'session-expired',
  UPDATE_COMPLETED: 'update-completed',
})

/**
 * Publica uma notificação interna.
 *
 * @param {string} type Um dos {@link NotificationType}.
 * @param {string} message Mensagem curta e segura.
 * @param {object} [payload] Dados adicionais (sem informações sensíveis).
 */
export function notify(type, message, payload = {}) {
  log.info(`notificação [${type}]: ${message}`)
  bus.emit(EVENTS.NOTIFICATION, { type, message, payload, at: new Date().toISOString() })
}
