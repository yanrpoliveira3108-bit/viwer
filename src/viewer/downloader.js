/**
 * @file src/viewer/downloader.js
 * @module viewer/downloader
 *
 * Download de mídias View Once para arquivo temporário.
 *
 * Decisões de projeto:
 * - streaming direto para disco (nunca carrega a mídia inteira em memória);
 * - limite de tamanho e timeout com cancelamento ativo (evita vazamentos);
 * - arquivo temporário é removido em qualquer falha;
 * - erros são classificados (expirada/corrompida/rede) para o pipeline.
 */

import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { api } from '../lib/baileys.js'
import { createTempFile, removeSilently } from '../utils/fs.js'
import { ViewerError, ErrorCategory } from '../utils/errors.js'
import { createLogger } from '../logger/index.js'

const log = createLogger('DOWNLOAD')

/** Extensões por tipo de mídia (padrão quando o mimetype não esclarece). */
const DEFAULT_EXT = {
  image: '.jpg',
  video: '.mp4',
  gif: '.mp4',
  audio: '.ogg',
  document: '.bin',
  sticker: '.webp',
}

/** Subtipos de mimetype conhecidos → extensão. */
const EXT_BY_SUBTYPE = {
  jpeg: '.jpg',
  jpg: '.jpg',
  png: '.png',
  webp: '.webp',
  gif: '.gif',
  mp4: '.mp4',
  '3gpp': '.3gp',
  ogg: '.ogg',
  mpeg: '.mp3',
  mp3: '.mp3',
  aac: '.aac',
  m4a: '.m4a',
  wav: '.wav',
  pdf: '.pdf',
  zip: '.zip',
}

/**
 * Determina a extensão do arquivo de destino.
 * Prioriza a extensão do nome original (documentos) e depois o mimetype.
 *
 * @param {string} mediaType Tipo normalizado.
 * @param {object|null} mediaMessage Mídia interna.
 * @returns {string} Extensão com ponto.
 */
export function resolveExtension(mediaType, mediaMessage) {
  const fileName = mediaMessage?.fileName
  if (typeof fileName === 'string' && fileName.includes('.')) {
    const ext = path.extname(fileName).toLowerCase()
    if (ext.length <= 8) return ext
  }
  const mimetype = String(mediaMessage?.mimetype ?? '')
  const subtype = mimetype.split('/')[1]?.split(';')[0]?.toLowerCase()
  if (subtype && EXT_BY_SUBTYPE[subtype]) return EXT_BY_SUBTYPE[subtype]
  return DEFAULT_EXT[mediaType] ?? '.bin'
}

/**
 * Baixa a mídia de uma mensagem para um arquivo temporário.
 *
 * @param {object} options Opções.
 * @param {object} options.message WAMessage completa (key + message).
 * @param {string} options.mediaType Tipo normalizado.
 * @param {object|null} options.mediaMessage Mídia interna (metadados).
 * @param {string} options.tempDir Diretório temporário.
 * @param {number} options.timeoutMs Tempo máximo de download.
 * @param {number} options.maxBytes Tamanho máximo aceito.
 * @returns {Promise<{filePath: string, sizeBytes: number}>}
 * @throws {ViewerError} Categoria `expired|corrupted|network|timeout|unknown`.
 */
export async function downloadToTempFile({
  message,
  mediaType,
  mediaMessage,
  tempDir,
  timeoutMs,
  maxBytes,
}) {
  const { downloadMediaMessage } = api()
  const filePath = await createTempFile(
    tempDir,
    'viewer',
    resolveExtension(mediaType, mediaMessage)
  )
  const writeStream = fs.createWriteStream(filePath)

  let timeoutHandle = null
  let sizeBytes = 0
  let sourceStream = null

  try {
    sourceStream = await downloadMediaMessage(message, 'stream', {})

    // Timeout ativo: destrói as duas pontas para liberar rede/memória.
    const timeout = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new ViewerError(ErrorCategory.TIMEOUT, 'tempo de download excedido'))
        sourceStream?.destroy?.()
        writeStream.destroy()
      }, timeoutMs)
      timeoutHandle.unref?.()
    })

    const transfer = pipeline(
      sourceStream,
      async function* enforceLimit(source) {
        for await (const chunk of source) {
          sizeBytes += chunk.length
          if (sizeBytes > maxBytes) {
            throw new ViewerError(ErrorCategory.CORRUPTED, 'mídia acima do limite configurado')
          }
          yield chunk
        }
      },
      writeStream
    )

    await Promise.race([transfer, timeout])
    clearTimeout(timeoutHandle)

    const stats = await fs.promises.stat(filePath)
    log.debug(`download gravado em arquivo temporário (${stats.size} bytes)`)
    return { filePath, sizeBytes: stats.size }
  } catch (error) {
    clearTimeout(timeoutHandle)
    await removeSilently(filePath)
    throw error
  } finally {
    // Garante liberação de recursos mesmo em caminhos inesperados.
    sourceStream?.destroy?.()
  }
}
