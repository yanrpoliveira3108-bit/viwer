/**
 * @file src/lib/baileys.js
 * @module lib/baileys
 *
 * Camada de compatibilidade com a biblioteca oficial do projeto:
 * `@lucasmod/boruto-vk7-baileys` (https://github.com/Otakump4/boruto_vk7-baileys).
 *
 * Este é o ÚNICO ponto do Viewer que conhece o layout físico da biblioteca.
 * O tarball publicado da biblioteca já mudou de layout entre versões
 * (monorepo com o código em `baileys/lib` vs. raiz com `lib`), portanto a
 * resolução do ponto de entrada é feita por tentativa ordenada de candidatos.
 * Quando o empacotamento da biblioteca for normalizado em uma versão futura,
 * nenhum módulo do Viewer precisará ser alterado — apenas este adaptador.
 */

import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

/** Nome do pacote oficial exigido pelo projeto. */
export const BAILEYS_PACKAGE = '@lucasmod/boruto-vk7-baileys'

/**
 * Candidatos a ponto de entrada, em ordem de prioridade.
 * O primeiro que resolver será utilizado e memorizado.
 */
const ENTRY_CANDIDATES = [
  // Layout atual (2.x): monorepo publicado com o código em baileys/lib.
  `${BAILEYS_PACKAGE}/baileys/lib/index.js`,
  // Layout canônico: entrada principal declarada no package.json.
  BAILEYS_PACKAGE,
  // Layout alternativo: build compilado na raiz do pacote.
  `${BAILEYS_PACKAGE}/lib/index.js`,
]

/** @type {{ api: object, entry: string } | null} */
let cached = null

/**
 * Versão do "aplicativo acompanhante" anunciada no DeviceProps durante o
 * registro. O servidor do WhatsApp passou a exigir esse campo para aceitar
 * sessões de Pairing Code; o Baileys mantido (WhiskeySockets) o envia, mas
 * o fork oficial do projeto congelou antes dessa mudança. Valores mantidos
 * em sincronia com o Baileys mantido.
 */
const COMPANION_DEVICE_VERSION = { primary: 10, secondary: 15, tertiary: 7 }

/**
 * Capacidades de sincronização de histórico anunciadas no registro.
 * Espelha o objeto enviado pelo Baileys mantido (campos desconhecidos pelo
 * protobuf do fork são ignorados na codificação, sem efeito colateral).
 */
const COMPANION_HISTORY_SYNC_CONFIG = {
  storageQuotaMb: 10240,
  inlineInitialPayloadInE2EeMsg: true,
  supportCallLogHistory: false,
  supportBotUserAgentChatHistory: true,
  supportCagReactionsAndPolls: true,
  supportBizHostedMsg: true,
  supportRecentSyncChunkMessageCountTuning: true,
  supportHostedGroupMsg: true,
  supportFbidBotChatHistory: true,
  supportMessageAssociation: true,
  supportGroupHistory: false,
}

/** Patches de compatibilidade já aplicados? */
let patchesApplied = false

/**
 * Flags de diagnóstico para os patches de registro (ajustam o registro
 * enviado ao servidor sem reinstalar nada):
 * - VIEWER_REG_VERSION_PATCH=0  desativa a injeção de DeviceProps.version;
 * - VIEWER_REG_HISTORY_PATCH=1  ativa também o historySyncConfig.
 * @returns {{version: boolean, history: boolean}}
 */
function getRegistrationPatchFlags() {
  return {
    version: process.env.VIEWER_REG_VERSION_PATCH !== '0',
    history: process.env.VIEWER_REG_HISTORY_PATCH === '1',
  }
}

/**
 * Aplica correções de compatibilidade no fork congelado.
 *
 * O módulo `Socket/socket.js` resolve `Utils.generateRegistrationNode` por
 * acesso a propriedade em tempo de chamada (getter vivo no barrel), então
 * substituir a função no módulo `Utils/validate-connection.js` altera o nó
 * de registro enviado ao servidor — sem tocar nos arquivos da biblioteca.
 *
 * @param {object} apiObj API da biblioteca já carregada.
 */
function applyCompatibilityPatches(apiObj) {
  if (patchesApplied) return
  patchesApplied = true

  try {
    const barrelCandidates = [
      `${BAILEYS_PACKAGE}/baileys/lib/Utils/index.js`,
      `${BAILEYS_PACKAGE}/lib/Utils/index.js`,
    ]
    const validateCandidates = [
      `${BAILEYS_PACKAGE}/baileys/lib/Utils/validate-connection.js`,
      `${BAILEYS_PACKAGE}/lib/Utils/validate-connection.js`,
    ]

    let barrel = null
    let validateModule = null
    for (const [index, candidate] of barrelCandidates.entries()) {
      try {
        // O barrel PRECISA ser carregado antes do patch (os getters vivos
        // só existem depois que ele materializa as reexportações).
        barrel = require(require.resolve(candidate))
        validateModule = require(require.resolve(validateCandidates[index]))
        break
      } catch {
        /* tenta o próximo layout */
      }
    }
    if (!barrel || !validateModule) return

    const original = validateModule.generateRegistrationNode
    if (typeof original !== 'function') return

    validateModule.generateRegistrationNode = (signalCreds, config) => {
      const node = original(signalCreds, config)
      try {
        const flags = getRegistrationPatchFlags()
        if (!flags.version && !flags.history) return node
        const pairingData = node?.devicePairingData
        if (pairingData?.deviceProps && apiObj?.proto?.DeviceProps) {
          const props = apiObj.proto.DeviceProps.decode(pairingData.deviceProps)
          if (flags.version) props.version = { ...COMPANION_DEVICE_VERSION }
          if (flags.history) props.historySyncConfig = { ...COMPANION_HISTORY_SYNC_CONFIG }
          pairingData.deviceProps = apiObj.proto.DeviceProps.encode(props).finish()
        }
      } catch {
        /* sem os campos segue o fluxo original (telemetria acusa) */
      }
      return node
    }

    // Confirma que o barrel enxerga a função substituída.
    if (barrel.generateRegistrationNode !== validateModule.generateRegistrationNode) {
      validateModule.generateRegistrationNode = original
      return
    }
    const flags = getRegistrationPatchFlags()
    // Diagnóstico visível: confirma se o patch está ativo neste processo.
    // eslint-disable-next-line no-console
    console.log(
      `[VIEWER] patch de compatibilidade do registro ativo ` +
        `(version=${flags.version ? 'sim' : 'não'}, historySyncConfig=${flags.history ? 'sim' : 'não'})`
    )
  } catch {
    /* patch é otimização de compatibilidade; nunca impede a inicialização */
  }
}

/**
 * Carrega (uma única vez) a biblioteca Baileys oficial do projeto.
 *
 * @returns {object} Módulo exportado pela biblioteca.
 * @throws {Error} Quando nenhum ponto de entrada puder ser resolvido.
 */
export function getBaileys() {
  if (cached) return cached.api

  const errors = []
  for (const candidate of ENTRY_CANDIDATES) {
    try {
      const resolved = require.resolve(candidate)

      const api = require(resolved)
      cached = { api: api.default ? { ...api, default: api.default } : api, entry: resolved }
      applyCompatibilityPatches(cached.api)
      return cached.api
    } catch (error) {
      errors.push(`${candidate}: ${error.message}`)
    }
  }

  throw new Error(
    `[VIEWER] Não foi possível carregar ${BAILEYS_PACKAGE}.\n` +
      `Execute \`npm install\` e verifique a instalação.\n` +
      `Tentativas:\n${errors.map((e) => `  - ${e}`).join('\n')}`
  )
}

/**
 * Versão instalada da biblioteca (lida do package.json do pacote).
 *
 * @returns {string} Versão SemVer ou `'desconhecida'`.
 */
export function getBaileysVersion() {
  const candidates = [`${BAILEYS_PACKAGE}/package.json`, `${BAILEYS_PACKAGE}/baileys/package.json`]
  for (const candidate of candidates) {
    try {
      const pkg = require(require.resolve(candidate))
      if (pkg && typeof pkg.version === 'string') return pkg.version
    } catch {
      /* tenta o próximo candidato */
    }
  }
  return 'desconhecida'
}

/**
 * Diretório raiz do pacote instalado (útil para diagnósticos).
 *
 * @returns {string|null} Caminho absoluto ou `null` se não carregado.
 */
export function getBaileysRoot() {
  try {
    const resolved = require.resolve(`${BAILEYS_PACKAGE}/package.json`)
    return path.dirname(resolved)
  } catch {
    return null
  }
}

/**
 * Versão do WhatsApp embutida na biblioteca (arquivo de padrão do fork).
 * Usada como último recurso quando nenhuma fonte remota está acessível.
 *
 * @returns {number[]|null} Tripla de versão ou `null` se indisponível.
 */
export function getBundledWaVersion() {
  const candidates = [
    `${BAILEYS_PACKAGE}/baileys/lib/Defaults/baileys-version.json`,
    `${BAILEYS_PACKAGE}/lib/Defaults/baileys-version.json`,
  ]
  for (const candidate of candidates) {
    try {
      const data = require(require.resolve(candidate))
      if (Array.isArray(data?.version)) return data.version
    } catch {
      /* tenta o próximo candidato */
    }
  }
  return null
}

/**
 * Acesso conveniente à API carregada.
 * Todos os módulos do Viewer devem importar exclusivamente daqui.
 *
 * @returns {object} API da biblioteca.
 */
export const api = () => getBaileys()
