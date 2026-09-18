/**
 * @file src/viewer/parser.js
 * @module viewer/parser
 *
 * Parser de mensagens do WhatsApp → formato interno do Viewer.
 *
 * Nunca confiamos nos dados recebidos: todos os campos são validados e
 * normalizados aqui, e o restante do sistema trabalha apenas com o formato
 * interno descrito abaixo.
 *
 * Formato interno:
 * {
 *   id: string,            // stanzaId da mensagem
 *   remoteJid: string,     // JID do chat (normalizado, sem device)
 *   participant: string?,  // autor em grupos
 *   fromMe: boolean,
 *   timestampMs: number,
 *   raw: object,           // WAMessage original (para download)
 *   quoted: {              // presente quando é uma resposta
 *     stanzaId: string,
 *     participant: string?,
 *     content: object      // quotedMessage bruto
 *   } | null,
 *   reaction: {            // presente quando é uma reação via upsert
 *     targetKey: object,   // chave da mensagem reagida
 *     emoji: string
 *   } | null,
 * }
 */

import { api } from '../lib/baileys.js'

/**
 * Converte uma WAMessage em formato interno do Viewer.
 *
 * @param {object} waMessage Mensagem recebida da biblioteca.
 * @returns {object|null} Formato interno, ou `null` quando inutilizável.
 */
export function parseMessage(waMessage) {
  if (!waMessage?.key?.id || !waMessage?.key?.remoteJid) return null

  const { extractMessageContent, normalizeMessageContent } = api()
  const content =
    extractMessageContent(waMessage.message) ?? normalizeMessageContent(waMessage.message)

  const parsed = {
    id: waMessage.key.id,
    remoteJid: waMessage.key.remoteJid,
    participant: waMessage.key.participant ?? null,
    fromMe: waMessage.key.fromMe === true,
    timestampMs: Number(waMessage.messageTimestamp) * 1000 || Date.now(),
    raw: waMessage,
    quoted: null,
    reaction: null,
  }

  // Resposta: extrai contexto da mensagem citada.
  const extended = content?.extendedTextMessage
  const contextInfo = extended?.contextInfo
  if (contextInfo?.stanzaId && contextInfo?.quotedMessage) {
    parsed.quoted = {
      stanzaId: String(contextInfo.stanzaId),
      participant: contextInfo.participant ?? null,
      content: contextInfo.quotedMessage,
    }
  }

  // Reação transportada como mensagem (deduplicada com o evento próprio).
  const reaction = content?.reactionMessage
  if (reaction?.key?.id) {
    parsed.reaction = {
      targetKey: {
        remoteJid: reaction.key.remoteJid ?? parsed.remoteJid,
        id: String(reaction.key.id),
        fromMe: reaction.key.fromMe === true,
      },
      emoji: String(reaction.text ?? ''),
    }
  }

  return parsed
}

/**
 * Verifica se um JID representa um grupo.
 * @param {string} jid JID.
 * @returns {boolean}
 */
export function isGroupJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@g.us')
}
