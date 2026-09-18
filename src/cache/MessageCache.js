/**
 * @file src/cache/MessageCache.js
 * @module cache
 *
 * Cache inteligente de mensagens View Once.
 *
 * O Método 2 (reação) e o Método 1 (resposta) precisam localizar a mensagem
 * original para baixar a mídia; como o WhatsApp não reenvia o conteúdo, o
 * Viewer indexa cada View Once recebida enquanto está conectado.
 *
 * Projeto para baixo consumo:
 * - guarda somente o essencial (chave + mensagem original com chaves de mídia);
 * - capacidade máxima com evicção do registro mais antigo (ordem de inserção);
 * - validade (TTL) com limpeza periódica em UM único timer;
 * - conjunto de "processadas" impede reprocessamento/duplicidade;
 * - conjunto "em andamento" impede downloads concorrentes duplicados.
 */

export class MessageCache {
  /**
   * @param {object} options Opções.
   * @param {number} options.maxEntries Capacidade máxima de indexadas.
   * @param {number} options.ttlMs Validade dos registros (ms).
   * @param {number} options.sweepIntervalMs Intervalo da limpeza (ms).
   * @param {import('../logger/index.js')} [options.logger] Logger opcional.
   */
  constructor({ maxEntries, ttlMs, sweepIntervalMs, logger }) {
    this.maxEntries = Math.max(1, maxEntries)
    this.ttlMs = ttlMs
    this.log = logger

    /** Índice principal: `remoteJid:stanzaId` → entrada. @type {Map<string, object>} */
    this.index = new Map()
    /** Ids já recuperados: id → expiração (ms epoch). @type {Map<string, number>} */
    this.processed = new Map()
    /** Ids com recuperação em andamento. @type {Set<string>} */
    this.inFlight = new Set()

    this.timer = setInterval(() => this.sweep(), sweepIntervalMs)
    this.timer.unref()
  }

  /**
   * Chave composta do índice.
   * @param {string} remoteJid JID do chat (normalizado).
   * @param {string} id Id da mensagem (stanzaId).
   * @returns {string}
   */
  static keyOf(remoteJid, id) {
    return `${remoteJid}:${id}`
  }

  /**
   * Indexa uma mensagem View Once recebida.
   * @param {object} message WAMessage completo (key + message).
   * @param {string} mediaType Tipo de mídia detectado.
   */
  set(message, mediaType) {
    const remoteJid = message?.key?.remoteJid
    const id = message?.key?.id
    if (!remoteJid || !id) return
    const key = MessageCache.keyOf(remoteJid, id)
    // Reinserção move para o fim (mais recente).
    this.index.delete(key)
    this.index.set(key, {
      key: message.key,
      message: message.message,
      mediaType,
      at: Date.now(),
    })
    // Evicção do registro mais antigo quando estoura a capacidade.
    if (this.index.size > this.maxEntries) {
      const oldest = this.index.keys().next().value
      this.index.delete(oldest)
    }
  }

  /**
   * Localiza a mensagem original indexada.
   * @param {string} remoteJid JID do chat.
   * @param {string} id StanzaId.
   * @returns {{key: object, message: object, mediaType: string}|null}
   */
  lookup(remoteJid, id) {
    const entry = this.index.get(MessageCache.keyOf(remoteJid, id))
    if (!entry) return null
    if (Date.now() - entry.at > this.ttlMs) {
      this.index.delete(MessageCache.keyOf(remoteJid, id))
      return null
    }
    return entry
  }

  /**
   * Marca um id como recuperado (impede duplicidade futura).
   * @param {string} id StanzaId.
   */
  markProcessed(id) {
    this.processed.set(id, Date.now() + this.ttlMs)
    if (this.processed.size > this.maxEntries * 2) {
      const oldest = this.processed.keys().next().value
      this.processed.delete(oldest)
    }
  }

  /**
   * @param {string} id StanzaId.
   * @returns {boolean} `true` se já recuperado.
   */
  isProcessed(id) {
    return this.processed.has(id)
  }

  /**
   * Reserva um id para processamento exclusivo.
   * @param {string} id StanzaId.
   * @returns {boolean} `true` se reservado; `false` se já em andamento.
   */
  markInFlight(id) {
    if (this.inFlight.has(id)) return false
    this.inFlight.add(id)
    return true
  }

  /**
   * Libera a reserva de processamento.
   * @param {string} id StanzaId.
   */
  releaseInFlight(id) {
    this.inFlight.delete(id)
  }

  /** Quantidade de mensagens indexadas (Dashboard). @returns {number} */
  get size() {
    return this.index.size
  }

  /** Remove registros vencidos (chamada pelo timer e em testes). */
  sweep() {
    const now = Date.now()
    for (const [key, entry] of this.index) {
      if (now - entry.at > this.ttlMs) this.index.delete(key)
    }
    for (const [id, expires] of this.processed) {
      if (expires <= now) this.processed.delete(id)
    }
  }

  /** Encerra o cache liberando o timer. */
  close() {
    clearInterval(this.timer)
    this.index.clear()
    this.processed.clear()
    this.inFlight.clear()
  }
}
