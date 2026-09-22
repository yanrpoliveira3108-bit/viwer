/**
 * @file src/viewer/pipeline.js
 * @module viewer/pipeline
 *
 * Orquestrador de recuperação de mídias View Once.
 *
 * Fluxo (idêntico para o Método 1 — resposta — e Método 2 — reação, em
 * conversas privadas e grupos):
 *
 *   1. localizar a mensagem original (cache → conteúdo citado embutido);
 *   2. confirmar que é View Once e detectar o tipo da mídia;
 *   3. baixar para arquivo temporário (streaming);
 *   4. remover a propriedade View Once (conteúdo de saída nunca a contém);
 *   5. reenviar para o chat privado do próprio número conectado;
 *   6. limpar recursos temporários e registrar tempos/estatísticas.
 *
 * Proteções: anti-duplicidade (processadas + em andamento), limites de
 * tamanho/tempo, classificação de erros e limpeza garantida (finally).
 */

import { bus } from '../core/EventBus.js'
import { EVENTS } from '../constants.js'
import { analyzeContent, isQuotedContentDownloadable } from './detector.js'
import { classifyChatJid } from './parser.js'
import { downloadToTempFile } from './downloader.js'
import { buildOutgoingContent, sendMedia } from './sender.js'
import { removeSilently } from '../utils/fs.js'
import { classifyError, ErrorCategory, describeError } from '../utils/errors.js'
import { createLogger } from '../logger/index.js'

const log = createLogger('VIEWER')

/** Razões de ignorar uma recuperação (todas previstas pelo projeto). */
export const SkipReason = Object.freeze({
  NOT_VIEW_ONCE: 'nao-e-view-once',
  NO_MEDIA: 'sem-midia',
  NOT_FOUND: 'original-nao-localizada',
  DUPLICATE: 'duplicada',
  DISABLED: 'metodo-desativado',
})

export class RecoveryPipeline {
  /**
   * @param {object} deps Dependências injetadas.
   * @param {import('../cache/MessageCache.js').MessageCache} deps.cache Cache de VO.
   * @param {import('../stats/Stats.js').Stats} deps.stats Estatísticas.
   * @param {import('../config/Config.js').Config} deps.config Configuração.
   * @param {() => object|null} deps.getSocket Fornece o socket conectado.
   * @param {() => string|null} deps.getSelfJid JID do número conectado.
   */
  constructor({ cache, stats, config, getSocket, getSelfJid }) {
    this.cache = cache
    this.stats = stats
    this.config = config
    this.getSocket = getSocket
    this.getSelfJid = getSelfJid
  }

  /**
   * Indexa uma View Once recebida no cache (chamado pelo módulo de eventos).
   * @param {object} waMessage Mensagem completa recebida.
   * @returns {boolean} `true` se era View Once com mídia e foi indexada.
   */
  indexIncoming(waMessage) {
    try {
      const analysis = analyzeContent(waMessage?.message)
      if (!analysis.viewOnce || !analysis.mediaType) return false
      this.cache.set(waMessage, analysis.mediaType)
      log.info(
        `View Once indexada no cache (${classifyChatJid(waMessage.key.remoteJid)}, ` +
          `${analysis.mediaType})`
      )
      bus.emit(EVENTS.VO_DETECTED, {
        origin: 'received',
        chatJid: waMessage.key.remoteJid,
        mediaType: analysis.mediaType,
      })
      return true
    } catch (error) {
      log.warn(`falha ao indexar view once: ${describeError(error)}`)
      return false
    }
  }

  /**
   * Executa a recuperação completa para uma mensagem-alvo.
   *
   * @param {object} options Opções.
   * @param {'reply'|'reaction'|'channel-auto'} options.source Método gatilho.
   * @param {string} options.chatJid JID do chat (grupo ou privado).
   * @param {{remoteJid: string, id: string}} options.targetKey Chave da original.
   * @param {object|null} [options.fallbackContent] Conteúdo citado embutido
   *        (Método 1), usado apenas se a original não estiver no cache.
   * @returns {Promise<boolean>} `true` se a mídia foi recuperada.
   */
  async recover({ source, chatJid, targetKey, fallbackContent = null }) {
    const startedAt = Date.now()
    const id = targetKey?.id

    if (!chatJid || !id) {
      this.stats.skipped()
      return false
    }

    // Anti-duplicidade: já recuperada ou em recuperação agora.
    if (this.cache.isProcessed(id) || !this.cache.markInFlight(id)) {
      this.stats.duplicateBlocked()
      log.debug(`processamento duplicado impedido (id=${id})`)
      bus.emit(EVENTS.RECOVERY_SKIPPED, { source, reason: SkipReason.DUPLICATE })
      return false
    }

    let filePath = null
    try {
      // 1. Localizar a mensagem original.
      let original = this.cache.lookup(chatJid, id)
      if (!original && fallbackContent && isQuotedContentDownloadable(fallbackContent)) {
        original = {
          key: { remoteJid: chatJid, id, fromMe: false },
          message: fallbackContent,
          mediaType: null,
        }
      }
      if (!original) {
        this.stats.skipped()
        log.warn(
          `original não localizada (${classifyChatJid(chatJid)}, id=${id}) — ` +
            'a View Once precisa ter chegado com o Viewer conectado para ser recuperada'
        )
        bus.emit(EVENTS.RECOVERY_SKIPPED, { source, reason: SkipReason.NOT_FOUND })
        return false
      }

      // 2. Confirmar View Once e detectar o tipo da mídia.
      const analysis = analyzeContent(original.message)
      if (!analysis.viewOnce) {
        this.stats.skipped()
        log.info(`mensagem não é View Once — ignorada (id=${id})`)
        bus.emit(EVENTS.RECOVERY_SKIPPED, { source, reason: SkipReason.NOT_VIEW_ONCE })
        return false
      }
      if (!analysis.mediaType) {
        this.stats.skipped()
        log.info(`View Once sem mídia suportada — ignorada (id=${id})`)
        bus.emit(EVENTS.RECOVERY_SKIPPED, { source, reason: SkipReason.NO_MEDIA })
        return false
      }

      const sock = this.getSocket()
      const selfJid = this.getSelfJid()
      if (!sock || !selfJid) {
        log.warn('socket indisponível; recuperação adiada')
        return false
      }

      log.info(`View Once detectada (${analysis.mediaType}, origem: ${source})`)
      bus.emit(EVENTS.RECOVERY_START, { source, chatJid, id, mediaType: analysis.mediaType })

      // 3. Download (streaming para arquivo temporário).
      log.info('download iniciado')
      bus.emit(EVENTS.RECOVERY_DOWNLOAD_START, { id, mediaType: analysis.mediaType })
      const download = await downloadToTempFile({
        message: { key: original.key, message: original.message },
        mediaType: analysis.mediaType,
        mediaMessage: analysis.mediaMessage,
        tempDir: this.config.resolvePath(this.config.get('media.tempDir')),
        timeoutMs: this.config.get('media.downloadTimeoutMs'),
        maxBytes: this.config.get('media.maxFileSizeMB') * 1024 * 1024,
      })
      filePath = download.filePath
      log.info(`download concluído (${download.sizeBytes} bytes)`)
      bus.emit(EVENTS.RECOVERY_DOWNLOAD_COMPLETE, { id, sizeBytes: download.sizeBytes })

      // 4+5. Reenvio sem View Once para o privado do número conectado.
      log.info('envio iniciado')
      bus.emit(EVENTS.RECOVERY_SEND_START, { id })
      const content = buildOutgoingContent({
        mediaType: analysis.mediaType,
        mediaMessage: analysis.mediaMessage,
        filePath,
      })
      await sendMedia(sock, selfJid, content, this.config.get('media.sendTimeoutMs'))
      log.info('envio concluído')
      bus.emit(EVENTS.RECOVERY_SEND_COMPLETE, { id })

      const durationMs = Date.now() - startedAt
      this.cache.markProcessed(id)
      this.stats.mediaRecovered(analysis.mediaType, durationMs)
      log.info(`mídia recuperada — tempo gasto ${durationMs}ms`)
      bus.emit(EVENTS.RECOVERY_COMPLETE, {
        source,
        id,
        mediaType: analysis.mediaType,
        durationMs,
      })
      return true
    } catch (error) {
      const category = classifyError(error)
      this.#handleFailure(category, error, id, source)
      return false
    } finally {
      this.cache.releaseInFlight(id)
      if (filePath) await removeSilently(filePath)
    }
  }

  /**
   * Trata falhas da recuperação sem propagar exceções.
   * Mensagens expiradas/apagadas/sem mídia são ignoradas automaticamente.
   *
   * @param {string} category Categoria classificada do erro.
   * @param {unknown} error Erro original.
   * @param {string} id StanzaId.
   * @param {string} source Método gatilho.
   */
  #handleFailure(category, error, id, source) {
    bus.emit(EVENTS.RECOVERY_ERROR, { source, id, category })

    switch (category) {
      case ErrorCategory.EXPIRED:
        this.stats.skipped()
        this.cache.markProcessed(id) // impede novas tentativas inúteis
        log.warn('mídia expirada ou apagada — ignorada')
        break
      case ErrorCategory.CORRUPTED:
      case ErrorCategory.NOT_ELIGIBLE:
        this.stats.skipped()
        this.cache.markProcessed(id)
        log.warn(`mídia ilegível/inválida — ignorada (${describeError(error)})`)
        break
      case ErrorCategory.TIMEOUT:
        this.stats.error()
        log.error('tempo limite excedido na recuperação')
        break
      case ErrorCategory.NETWORK:
        this.stats.error()
        log.error('falha de rede na recuperação')
        break
      default:
        this.stats.error()
        log.error(`erro na recuperação: ${describeError(error)}`)
    }
  }
}
