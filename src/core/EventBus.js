/**
 * @file src/core/EventBus.js
 * @module core/EventBus
 *
 * Barramento de eventos internos do Viewer.
 *
 * Toda comunicação entre módulos passa por aqui (baixo acoplamento):
 * nenhum módulo conhece a implementação do outro, apenas os nomes dos
 * eventos (ver `src/constants.js` → EVENTS). Novas funcionalidades são
 * adicionadas registrando novos listeners, sem alterar módulos existentes.
 */

import { EventEmitter } from 'node:events'

/** Limite de listeners por evento antes de avisar (proteção contra leaks). */
const MAX_LISTENERS = 64

class ViewerEventBus extends EventEmitter {
  constructor() {
    super()
    this.setMaxListeners(MAX_LISTENERS)
  }

  /**
   * Registra um listener protegido: exceções dentro de handlers nunca
   * derrubam o Viewer; são convertidas em eventos de erro observáveis.
   *
   * @param {string} event Nome do evento.
   * @param {Function} handler Função receptora.
   * @returns {Function} Handler registrado (para remoção).
   */
  safeOn(event, handler) {
    const wrapped = (...args) => {
      try {
        handler(...args)
      } catch (error) {
        // Evita recursão infinita se o próprio handler de erro falhar.
        if (event !== 'viewer:internal-error') {
          this.emit('viewer:internal-error', { event, error })
        }
      }
    }
    wrapped.__original = handler
    this.on(event, wrapped)
    return wrapped
  }

  /**
   * Remove um listener registrado via {@link safeOn}.
   * @param {string} event Nome do evento.
   * @param {Function} wrapped Handler retornado por `safeOn`.
   */
  safeOff(event, wrapped) {
    this.off(event, wrapped)
  }

  /**
   * Remove todos os listeners registrados por um módulo.
   * Conveniente para plugins e testes.
   * @param {string[]} events Lista de eventos.
   * @param {Function[]} handlers Handlers correspondentes.
   */
  detachAll(events, handlers) {
    events.forEach((event, i) => {
      if (handlers[i]) this.safeOff(event, handlers[i])
    })
  }
}

/** Instância única compartilhada pelo processo. */
export const bus = new ViewerEventBus()
