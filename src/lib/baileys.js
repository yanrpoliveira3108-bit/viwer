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
 * Acesso conveniente à API carregada.
 * Todos os módulos do Viewer devem importar exclusivamente daqui.
 *
 * @returns {object} API da biblioteca.
 */
export const api = () => getBaileys()
