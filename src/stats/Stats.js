/**
 * @file src/stats/Stats.js
 * @module stats
 *
 * Estatísticas do Viewer.
 * Contadores de sessão e acumulados (persistidos no banco), usados pelo
 * Dashboard agora e pelo futuro menu interativo.
 *
 * Tipos de mídia suportados (preparado para GIFs e mídias futuras):
 * image, video, gif, audio, document, sticker, other.
 */

import { bus } from '../core/EventBus.js'
import { EVENTS } from '../constants.js'

const MEDIA_TYPES = ['image', 'video', 'gif', 'audio', 'document', 'sticker', 'other']

/** @returns {object} Contadores zerados. */
function emptyCounters() {
  return {
    messagesProcessed: 0,
    mediaRecovered: 0,
    byType: Object.fromEntries(MEDIA_TYPES.map((t) => [t, 0])),
    errors: 0,
    skipped: 0,
    duplicatesBlocked: 0,
    totalRecoveryMs: 0,
  }
}

export class Stats {
  /**
   * @param {object} options Opções.
   * @param {import('../database/Database.js').Database} options.db Banco.
   * @param {boolean} [options.persist=true] Persistir acumulados.
   */
  constructor({ db, persist = true }) {
    this.db = db
    this.persist = persist
    this.startedAt = new Date()
    this.session = emptyCounters()
    this.total = persist ? { ...emptyCounters(), ...db.get('stats', 'total', {}) } : emptyCounters()
    this.total.byType = { ...emptyCounters().byType, ...this.total.byType }
  }

  /** Mensagem recebida/avaliada pelo pipeline. */
  messageProcessed() {
    this.session.messagesProcessed += 1
    this.total.messagesProcessed += 1
    this.#emit()
  }

  /**
   * Mídia recuperada com sucesso.
   * @param {string} mediaType Tipo de mídia normalizado.
   * @param {number} durationMs Tempo total do fluxo.
   */
  mediaRecovered(mediaType, durationMs) {
    const type = MEDIA_TYPES.includes(mediaType) ? mediaType : 'other'
    this.session.mediaRecovered += 1
    this.session.byType[type] += 1
    this.session.totalRecoveryMs += durationMs
    this.total.mediaRecovered += 1
    this.total.byType[type] += 1
    this.total.totalRecoveryMs += durationMs
    this.#persist()
    this.#emit()
  }

  /** Erro em recuperação (qualquer etapa). */
  error() {
    this.session.errors += 1
    this.total.errors += 1
    this.#persist()
    this.#emit()
  }

  /** Recuperação ignorada (expirada, sem mídia, não-VO...). */
  skipped() {
    this.session.skipped += 1
    this.total.skipped += 1
    this.#emit()
  }

  /** Processamento duplicado bloqueado pelo cache. */
  duplicateBlocked() {
    this.session.duplicatesBlocked += 1
    this.total.duplicatesBlocked += 1
    this.#emit()
  }

  /**
   * Fotografia das estatísticas (sessão + acumulado).
   * @returns {object}
   */
  snapshot() {
    const avgMs =
      this.session.mediaRecovered > 0
        ? Math.round(this.session.totalRecoveryMs / this.session.mediaRecovered)
        : 0
    return {
      startedAt: this.startedAt,
      session: { ...this.session },
      total: { ...this.total },
      avgRecoveryMs: avgMs,
    }
  }

  /** Persiste acumulados (agrupado no ciclo do banco). */
  #persist() {
    if (this.persist) this.db.set('stats', 'total', this.total)
  }

  /** Notifica interessados (Dashboard) sem acoplamento. */
  #emit() {
    bus.emit(EVENTS.STATS_UPDATED, this.snapshot())
  }
}
