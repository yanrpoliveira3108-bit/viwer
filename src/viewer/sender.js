/**
 * @file src/viewer/sender.js
 * @module viewer/sender
 *
 * Reenvio da mídia recuperada SEM a propriedade View Once.
 *
 * Preservação de metadados:
 * - legenda (`caption`);
 * - mimetype;
 * - nome do arquivo (documentos);
 * - duração (`seconds` de áudio/vídeo originais — evita reprocessamento);
 * - thumbnail original (`jpegThumbnail` — evita regeneração e mantém o
 *   preview exato, mesmo sem ffmpeg/sharp no aparelho);
 * - waveform de mensagens de voz;
 * - flag `ptt` (mensagens de voz) e `gifPlayback` (GIFs).
 *
 * A mídia NUNCA é reenviada como View Once: o campo `viewOnce` simplesmente
 * não é incluído no conteúdo de saída.
 */

/**
 * Constrói o conteúdo de envio para cada tipo de mídia.
 *
 * @param {object} options Opções.
 * @param {string} options.mediaType Tipo normalizado.
 * @param {object|null} options.mediaMessage Mídia interna original.
 * @param {string} options.filePath Arquivo temporário baixado.
 * @returns {object} Conteúdo para `sock.sendMessage`.
 */
export function buildOutgoingContent({ mediaType, mediaMessage, filePath }) {
  const media = { url: filePath }
  const original = mediaMessage ?? {}

  switch (mediaType) {
    case 'image':
      return {
        image: media,
        caption: original.caption || undefined,
        mimetype: original.mimetype || undefined,
        jpegThumbnail: original.jpegThumbnail || undefined,
      }

    case 'video':
    case 'gif':
      return {
        video: media,
        caption: original.caption || undefined,
        mimetype: original.mimetype || undefined,
        gifPlayback: mediaType === 'gif' ? true : original.gifPlayback || undefined,
        seconds: original.seconds || undefined,
        jpegThumbnail: original.jpegThumbnail || undefined,
      }

    case 'audio':
      return {
        audio: media,
        mimetype: original.mimetype || 'audio/ogg; codecs=opus',
        ptt: original.ptt === true,
        seconds: original.seconds || undefined,
        waveform: original.waveform || undefined,
      }

    case 'document':
      return {
        document: media,
        caption: original.caption || undefined,
        mimetype: original.mimetype || 'application/octet-stream',
        fileName: original.fileName || `viewer-${Date.now()}.bin`,
      }

    case 'sticker':
      return {
        sticker: media,
        mimetype: original.mimetype || 'image/webp',
      }

    default:
      // Tipos futuros: envio genérico como documento preserva o arquivo.
      return {
        document: media,
        mimetype: original.mimetype || 'application/octet-stream',
        fileName: original.fileName || `viewer-${Date.now()}.bin`,
      }
  }
}

/**
 * Envia a mídia recuperada para o destino.
 *
 * @param {object} sock Socket Baileys conectado.
 * @param {string} destination JID de destino (chat privado do próprio número).
 * @param {object} content Conteúdo gerado por {@link buildOutgoingContent}.
 * @param {number} timeoutMs Tempo máximo de envio.
 * @returns {Promise<object>} Mensagem enviada.
 * @throws {Error} Falha ou timeout de envio.
 */
export async function sendMedia(sock, destination, content, timeoutMs) {
  let timeoutHandle = null
  try {
    const timeout = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('tempo de envio excedido')), timeoutMs)
      timeoutHandle.unref?.()
    })
    const sent = await Promise.race([sock.sendMessage(destination, content), timeout])
    clearTimeout(timeoutHandle)
    return sent
  } finally {
    clearTimeout(timeoutHandle)
  }
}
