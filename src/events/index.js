/**
 * @file src/events/index.js
 * @module events
 *
 * Ponte entre os eventos da biblioteca (socket) e o barramento interno.
 * Aqui nascem os dois métodos oficiais de recuperação:
 *
 * - MÉTODO 1 (RESPOSTA):  o número conectado responde uma View Once →
 *   `messages.upsert` com `contextInfo.quotedMessage`.
 * - MÉTODO 2 (REAÇÃO):   o número conectado reage a uma View Once →
 *   evento `messages.reaction` (e `reactionMessage` no upsert, deduplicado).
 *
 * Qualquer emoji/reação suportada pelo WhatsApp funciona — não há filtro
 * de emoji; reações vazias (remoção) são ignoradas.
 *
 * O comportamento é idêntico em conversas privadas e grupos: a identificação
 * usa sempre o JID do chat + stanzaId, sem distinção.
 */

import { bus } from '../core/EventBus.js'
import { EVENTS } from '../constants.js'
import { parseMessage, classifyChatJid } from '../viewer/parser.js'
import { analyzeContent } from '../viewer/detector.js'
import { createLogger } from '../logger/index.js'

const log = createLogger('EVENTOS')

/**
 * Registra a ponte de eventos.
 * Os listeners são reanexados automaticamente a cada novo socket
 * (reconexões), sem duplicação.
 *
 * @param {object} deps Dependências.
 * @param {import('../viewer/pipeline.js').RecoveryPipeline} deps.pipeline Pipeline.
 * @param {import('../cache/MessageCache.js').MessageCache} deps.cache Cache.
 * @param {import('../stats/Stats.js').Stats} deps.stats Estatísticas.
 * @param {import('../config/Config.js').Config} deps.config Configuração.
 */
export function registerEventBridge({ pipeline, cache, stats, config }) {
  bus.safeOn(EVENTS.CONNECTION_SOCKET, ({ sock }) => attachSocket(sock))

  /**
   * Anexa listeners ao socket recém-criado.
   * @param {object} sock Socket Baileys.
   */
  function attachSocket(sock) {
    sock.ev.on('messages.upsert', ({ messages }) => {
      for (const message of messages ?? []) {
        try {
          handleUpsert(message)
        } catch (error) {
          log.error(`falha ao processar mensagem: ${error.message}`)
        }
      }
    })

    sock.ev.on('messages.reaction', (items) => {
      for (const item of items ?? []) {
        try {
          handleReactionEvent(item)
        } catch (error) {
          log.error(`falha ao processar reação: ${error.message}`)
        }
      }
    })

    log.debug('listeners anexados ao socket')
  }

  /**
   * Trata mensagem recebida (upsert).
   * @param {object} message WAMessage.
   */
  function handleUpsert(message) {
    const parsed = parseMessage(message)
    if (!parsed) return

    stats.messageProcessed()

    // Toda View Once recebida é indexada — base dos Métodos 1 e 2.
    const indexed = pipeline.indexIncoming(message)

    // Canais: o protocolo não entrega resposta nem autoria de reação, então
    // a View Once é recuperada automaticamente ao chegar (padrão ligado).
    if (
      indexed &&
      classifyChatJid(parsed.remoteJid) === 'canal' &&
      config.get('features.recoverChannelsAuto')
    ) {
      log.info('View Once de canal recebida — recuperação automática iniciada')
      void pipeline.recover({
        source: 'channel-auto',
        chatJid: message.key.remoteJid,
        targetKey: { remoteJid: message.key.remoteJid, id: message.key.id },
      })
      return
    }

    // Ponto de extensão para plugins/menu futuro (baixo acoplamento).
    bus.emit(EVENTS.WA_MESSAGE, parsed)

    if (!parsed.fromMe) return // os métodos reagem apenas a ações do número conectado

    // Método 2 (via upsert — deduplicado com o evento messages.reaction).
    if (parsed.reaction && config.get('features.recoverOnReaction')) {
      if (parsed.reaction.emoji) {
        log.info(`reação via mensagem detectada (${classifyChatJid(parsed.remoteJid)})`)
        void pipeline.recover({
          source: 'reaction',
          chatJid: parsed.remoteJid,
          targetKey: {
            remoteJid: parsed.reaction.targetKey.remoteJid,
            id: parsed.reaction.targetKey.id,
          },
        })
      }
      return
    }

    // Método 1 — resposta a uma View Once.
    if (parsed.quoted && config.get('features.recoverOnReply')) {
      const { stanzaId, content } = parsed.quoted
      const entry = cache.lookup(parsed.remoteJid, stanzaId)
      // Respostas a mensagens comuns são ignoradas silenciosamente.
      if (!entry && !analyzeContent(content).viewOnce) return

      log.info(`resposta a View Once detectada (${classifyChatJid(parsed.remoteJid)})`)
      void pipeline.recover({
        source: 'reply',
        chatJid: parsed.remoteJid,
        targetKey: { remoteJid: parsed.remoteJid, id: stanzaId },
        fallbackContent: content,
      })
    }
  }

  /**
   * Trata o evento dedicado de reações (Método 2).
   * @param {{reaction: object, key: object}} item Item do evento.
   */
  function handleReactionEvent({ reaction, key }) {
    if (!config.get('features.recoverOnReaction')) return
    if (!reaction?.key?.fromMe) return // apenas reações do número conectado
    if (!reaction.text) return // remoção de reação — nada a fazer
    if (!key?.id) return
    // Em alguns chats o reactionMessage.key chega sem remoteJid — a reação
    // só pode apontar para o próprio chat onde ocorreu.
    const targetJid = key.remoteJid || reaction.key?.remoteJid
    if (!targetJid) return

    log.info(`reação do número conectado detectada (${classifyChatJid(targetJid)})`)
    void pipeline.recover({
      source: 'reaction',
      chatJid: targetJid,
      targetKey: { remoteJid: targetJid, id: key.id },
    })
  }
}
