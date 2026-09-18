/**
 * @file src/lib/baileys-patches.js
 * @module lib/baileys-patches
 *
 * Patches de código-fonte aplicados na biblioteca instalada (node_modules)
 * ANTES do primeiro carregamento. Corrigem o fluxo de pareamento quebrado
 * pela mudança de protocolo do WhatsApp em ~28/07/2026, equivalente aos
 * ajustes ainda não lançados pelo Baileys mantido:
 *
 * 1. WhiskeySockets/Baileys#2602 — o servidor passou a enviar a notificação
 *    `link_code_companion_reg` também em um formato SEM os campos de
 *    criptografia; sem o guarda, o handler da biblioteca quebra com
 *    Boom('Invalid buffer', 400) e derruba o pareamento por código.
 *
 * 2. WhiskeySockets/Baileys#2765 — o servidor passou a enviar
 *    `<notification type="companion_reg_refresh">` aposentando o material de
 *    registro do acompanhante não pareado. Sem rotacionar o segredo ADV, o
 *    cliente continua se apresentando com material aposentado e o servidor
 *    recusa o pedido de pareamento (400 bad-request).
 *
 * Os patches são idempotentes (marcadores próprios), tolerantes a mudanças
 * de layout do pacote e nunca impedem a inicialização: se um patch não puder
 * ser aplicado, o Viewer segue e registra o fato em log.
 */

import fs from 'node:fs'
import path from 'node:path'

/** Nome do pacote oficial exigido pelo projeto. */
const BAILEYS_PACKAGE = '@lucasmod/boruto-vk7-baileys'

/** Marcadores dos patches (idempotência + diagnóstico). */
const MARKER_GUARD = '/* viewer-patch:guard-link-code-companion-reg */'
const MARKER_REFRESH = '/* viewer-patch:companion-reg-refresh */'

/**
 * Localiza os arquivos-alvo dentro do pacote instalado.
 * @param {(id: string) => string} resolveImpl require.resolve do chamador.
 * @returns {{root: string|null, messagesRecv: string|null, socket: string|null}}
 */
function locateTargets(resolveImpl) {
  let root = null
  try {
    root = path.dirname(resolveImpl(`${BAILEYS_PACKAGE}/package.json`))
  } catch {
    return { root: null, messagesRecv: null, socket: null }
  }
  const layouts = ['baileys/lib', 'lib']
  for (const layout of layouts) {
    const messagesRecv = path.join(root, layout, 'Socket', 'messages-recv.js')
    const socket = path.join(root, layout, 'Socket', 'socket.js')
    if (fs.existsSync(messagesRecv) && fs.existsSync(socket)) {
      return { root, messagesRecv, socket }
    }
  }
  return { root, messagesRecv: null, socket: null }
}

/**
 * Patch #2602: ignora a notificação sem campos de criptografia em vez de
 * quebrar. Âncora: abertura do case 'link_code_companion_reg'.
 * @param {string} filePath Caminho do messages-recv.js.
 * @returns {boolean} `true` se aplicado nesta chamada.
 */
function applyLinkCodeGuard(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  if (source.includes(MARKER_GUARD)) return false

  // Âncora completa: o case + a declaração da variável; o guarda entra
  // DEPOIS da declaração (referenciá-la antes causaria erro TDZ).
  const anchor =
    /(case 'link_code_companion_reg':\s*\n)(\s*)(const linkCodeCompanionReg = [^\n]*\n)/
  const match = source.match(anchor)
  if (!match) return false

  const [, caseLine, indent, declLine] = match
  const guard =
    `${indent}${MARKER_GUARD}\n` +
    `${indent}if (!WABinary_1.getBinaryNodeChildBuffer(linkCodeCompanionReg, 'primary_identity_pub')) break;\n`
  fs.writeFileSync(filePath, source.replace(anchor, `${caseLine}${indent}${declLine}${guard}`))
  return true
}

/**
 * Patch #2765: trata companion_reg_refresh rotacionando o segredo ADV
 * (equivalente ao handler do Baileys mantido; sem re-renderização de QR,
 * pois o Viewer pareia por código). Âncora: `return {` final do makeSocket.
 * @param {string} filePath Caminho do socket.js.
 * @returns {boolean} `true` se aplicado nesta chamada.
 */
function applyCompanionRegRefresh(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  if (source.includes(MARKER_REFRESH)) return false

  const anchor = /(\n\s*)return \{\s*\n\s*type: 'md',/
  if (!anchor.test(source)) return false

  const handler = `
    ${MARKER_REFRESH}
    // O servidor aposenta o material de registro do acompanhante não pareado;
    // sem rotacionar o segredo ADV, o pedido de pareamento é recusado (400).
    ws.on('CB:notification,type:companion_reg_refresh', (node) => {
        try {
            const children = Array.isArray(node?.content) ? node.content : []
            const valid = children.some((c) =>
                c?.tag === 'companion_reg_refresh' || c?.tag === 'pair-device-rotate-qr')
            if (!valid) return
            // Sessão registrada/pareamento em andamento mantém o segredo
            // (mesma regra do Baileys mantido: creds.me definido).
            if (authState.creds.me) return
            authState.creds.advSecretKey = crypto_1.randomBytes(32).toString('base64')
            ev.emit('creds.update', { advSecretKey: authState.creds.advSecretKey })
        }
        catch { /* handler de notificação nunca derruba a conexão */ }
    })
`
  fs.writeFileSync(filePath, source.replace(anchor, `$1${handler}$1return {\n        type: 'md',`))
  return true
}

/**
 * Aplica todos os patches de pareamento na biblioteca instalada.
 * @param {(id: string) => string} resolveImpl require.resolve do chamador.
 * @returns {{patched: string[], skipped: string[], failed: string[]}}
 */
export function applyPairingSourcePatches(resolveImpl) {
  const result = { patched: [], skipped: [], failed: [] }
  const { messagesRecv, socket } = locateTargets(resolveImpl)

  if (!messagesRecv || !socket) {
    result.failed.push('arquivos da biblioteca não localizados')
    return result
  }

  try {
    result[applyLinkCodeGuard(messagesRecv) ? 'patched' : 'skipped'].push(
      'guard link_code_companion_reg'
    )
  } catch {
    result.failed.push('guard link_code_companion_reg')
  }

  try {
    result[applyCompanionRegRefresh(socket) ? 'patched' : 'skipped'].push('companion_reg_refresh')
  } catch {
    result.failed.push('companion_reg_refresh')
  }

  return result
}

/** Marcadores exportados para testes/diagnóstico. */
export const PATCH_MARKERS = { guard: MARKER_GUARD, refresh: MARKER_REFRESH }
