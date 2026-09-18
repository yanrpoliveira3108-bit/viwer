/**
 * Testes do detector de View Once e classificação de mídia.
 * Cobrem as variantes atuais do WhatsApp e casos de fronteira.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  analyzeContent,
  isViewOnceMedia,
  isQuotedContentDownloadable,
} from '../src/viewer/detector.js'

test('viewOnceMessage clássico (imagem) é detectado', () => {
  const content = {
    viewOnceMessage: {
      message: {
        imageMessage: {
          url: 'https://mmg',
          mediaKey: Buffer.alloc(32),
          mimetype: 'image/jpeg',
          caption: 'oi',
          viewOnce: true,
        },
      },
    },
  }
  const result = analyzeContent(content)
  assert.equal(result.viewOnce, true)
  assert.equal(result.mediaType, 'image')
  assert.equal(result.mediaMessage.caption, 'oi')
})

test('viewOnceMessageV2 (vídeo com legenda) é detectado', () => {
  const content = {
    viewOnceMessageV2: {
      message: {
        videoMessage: {
          url: 'https://mmg',
          mediaKey: Buffer.alloc(32),
          caption: 'legenda',
          seconds: 12,
        },
      },
    },
  }
  const result = analyzeContent(content)
  assert.equal(result.viewOnce, true)
  assert.equal(result.mediaType, 'video')
})

test('viewOnceMessageV2Extension (áudio) é detectado', () => {
  const content = {
    viewOnceMessageV2Extension: {
      message: { audioMessage: { url: 'https://mmg', mediaKey: Buffer.alloc(32), ptt: true } },
    },
  }
  const result = analyzeContent(content)
  assert.equal(result.viewOnce, true)
  assert.equal(result.mediaType, 'audio')
})

test('view once dentro de mensagem temporária (ephemeral) é detectado', () => {
  const content = {
    ephemeralMessage: {
      message: {
        viewOnceMessage: {
          message: { stickerMessage: { url: 'https://mmg', mediaKey: Buffer.alloc(32) } },
        },
      },
    },
  }
  const result = analyzeContent(content)
  assert.equal(result.viewOnce, true)
  assert.equal(result.mediaType, 'sticker')
})

test('vídeo com gifPlayback vira GIF', () => {
  const content = {
    viewOnceMessage: {
      message: {
        videoMessage: { url: 'https://mmg', mediaKey: Buffer.alloc(32), gifPlayback: true },
      },
    },
  }
  assert.equal(analyzeContent(content).mediaType, 'gif')
})

test('mensagem comum NÃO é View Once', () => {
  const content = { imageMessage: { url: 'https://mmg', mediaKey: Buffer.alloc(32) } }
  const result = analyzeContent(content)
  assert.equal(result.viewOnce, false)
  assert.equal(result.mediaType, 'image')
})

test('texto simples não é mídia nem View Once', () => {
  const result = analyzeContent({ conversation: 'olá' })
  assert.equal(result.viewOnce, false)
  assert.equal(result.mediaType, null)
})

test('flag viewOnce na mídia interna também conta', () => {
  const content = {
    imageMessage: { url: 'https://mmg', mediaKey: Buffer.alloc(32), viewOnce: true },
  }
  assert.equal(analyzeContent(content).viewOnce, true)
})

test('conteúdo vazio não quebra', () => {
  assert.deepEqual(analyzeContent(undefined), {
    viewOnce: false,
    mediaType: null,
    innerType: null,
    mediaMessage: null,
  })
  assert.deepEqual(analyzeContent({}), {
    viewOnce: false,
    mediaType: null,
    innerType: null,
    mediaMessage: null,
  })
})

test('isViewOnceMedia integra detecção completa', () => {
  const vo = {
    key: { remoteJid: 'x@s.whatsapp.net', id: '1' },
    message: {
      viewOnceMessage: {
        message: { documentMessage: { url: 'u', mediaKey: Buffer.alloc(32), fileName: 'a.pdf' } },
      },
    },
  }
  assert.equal(isViewOnceMedia(vo), true)
  assert.equal(isViewOnceMedia({ key: {}, message: { conversation: 'oi' } }), false)
})

test('conteúdo citado exige chaves de mídia para download', () => {
  const complete = {
    viewOnceMessage: { message: { imageMessage: { url: 'u', mediaKey: Buffer.alloc(32) } } },
  }
  const semChaves = {
    viewOnceMessage: { message: { imageMessage: { caption: 'sem mídia' } } },
  }
  assert.equal(isQuotedContentDownloadable(complete), true)
  assert.equal(isQuotedContentDownloadable(semChaves), false)
})
