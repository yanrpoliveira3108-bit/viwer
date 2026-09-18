/**
 * @file src/viewer/detector.js
 * @module viewer/detector
 *
 * Detector de View Once e classificador de mídia.
 * Funções puras (sem estado, sem rede) — testáveis isoladamente.
 *
 * Compatível com todas as variantes atuais e preparado para futuras:
 * qualquer novo invólucro conhecido pela biblioteca é atravessado pelo
 * mesmo algoritmo de desenvelopamento encadeado.
 */

import { api } from '../lib/baileys.js'

/** Invólucros específicos de View Once. */
const VIEW_ONCE_WRAPPERS = new Set([
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
])

/**
 * Invólucros genéricos que podem envolver uma View Once
 * (mensagens temporárias, edições, legendas etc.).
 */
const GENERIC_WRAPPERS = new Set([
  'ephemeralMessage',
  'editedMessage',
  'lottieStickerMessage',
  'botInvokeMessage',
  'botTaskMessage',
  'botForwardedMessage',
  'groupStatusMessage',
  'groupStatusMessageV2',
  'groupMentionedMessage',
  'groupStatusMentionMessage',
  'statusMentionMessage',
  'statusAddYours',
  'eventCoverImage',
  'questionMessage',
  'limitSharingMessage',
  'documentWithCaptionMessage',
  'associatedChildMessage',
])

/** Profundidade máxima de desenvelopamento (proteção contra loops). */
const MAX_DEPTH = 8

/**
 * Classifica o tipo de mídia de uma mensagem já desenvelopada.
 *
 * @param {string|null} innerType Tipo de conteúdo interno.
 * @param {object|null} mediaMessage Objeto interno da mídia.
 * @returns {string|null} `image|video|gif|audio|document|sticker` ou `null`.
 */
export function classifyMediaType(innerType, mediaMessage) {
  switch (innerType) {
    case 'imageMessage':
      return 'image'
    case 'videoMessage':
      return mediaMessage?.gifPlayback ? 'gif' : 'video'
    case 'audioMessage':
      return 'audio'
    case 'documentMessage':
      return 'document'
    case 'stickerMessage':
      return 'sticker'
    default:
      return null
  }
}

/**
 * Analisa um conteúdo de mensagem do WhatsApp.
 *
 * Percorre a cadeia de invólucros (até `MAX_DEPTH`), detecta se há View Once
 * em qualquer nível e classifica a mídia interna.
 *
 * @param {object|undefined} content Campo `message` de uma WAMessage.
 * @returns {{
 *   viewOnce: boolean,
 *   mediaType: string|null,
 *   innerType: string|null,
 *   mediaMessage: object|null,
 * }} Resultado da análise.
 */
export function analyzeContent(content) {
  const { getContentType } = api()
  let current = content
  let viewOnce = false

  // O desenhovelopamento usa acesso direto às chaves (não getContentType,
  // que não reconhece invólucros como viewOnceMessageV2Extension).
  for (let depth = 0; current && depth < MAX_DEPTH; depth += 1) {
    const wrapper = findWrapperKey(current)
    if (!wrapper) break
    if (VIEW_ONCE_WRAPPERS.has(wrapper)) viewOnce = true
    current = current[wrapper]?.message ?? null
  }

  const innerType = current ? (getContentType(current) ?? null) : null
  const mediaMessage = innerType ? (current?.[innerType] ?? null) : null
  const mediaType = classifyMediaType(innerType, mediaMessage)

  // A flag `viewOnce` também existe na mídia interna em algumas variantes.
  if (!viewOnce && mediaMessage?.viewOnce === true) viewOnce = true

  return { viewOnce, mediaType, innerType, mediaMessage }
}

/**
 * Localiza a chave de invólucro presente em um conteúdo.
 * @param {object} content Conteúdo.
 * @returns {string|null} Nome da chave ou `null`.
 */
function findWrapperKey(content) {
  for (const key of VIEW_ONCE_WRAPPERS) {
    if (content[key]) return key
  }
  for (const key of GENERIC_WRAPPERS) {
    if (content[key]) return key
  }
  return null
}

/**
 * Verifica rapidamente se uma WAMessage é uma View Once com mídia.
 *
 * @param {object} waMessage Mensagem completa (`key` + `message`).
 * @returns {boolean}
 */
export function isViewOnceMedia(waMessage) {
  const result = analyzeContent(waMessage?.message)
  return result.viewOnce && result.mediaType !== null
}

/**
 * Confirma se um conteúdo citado (quotedMessage) é elegível para
 * recuperação: precisa ser View Once e conter mídia com chaves de download.
 *
 * @param {object} quotedContent Conteúdo citado.
 * @returns {boolean}
 */
export function isQuotedContentDownloadable(quotedContent) {
  const { viewOnce, mediaType, mediaMessage } = analyzeContent(quotedContent)
  if (!viewOnce || !mediaType || !mediaMessage) return false
  return Boolean(mediaMessage.url || mediaMessage.directPath) && Boolean(mediaMessage.mediaKey)
}
