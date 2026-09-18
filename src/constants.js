/**
 * @file src/constants.js
 * @module constants
 *
 * Identidade e constantes globais do Viewer.
 * Valores derivados (versão, canal) são lidos do package.json e da
 * configuração; nada aqui deve ser alterado em tempo de execução.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(here, '..')

/**
 * Lê o package.json do projeto de forma defensiva.
 * @returns {object} Conteúdo do package.json ou objeto mínimo.
 */
function readPackageJson() {
  try {
    return JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
  } catch {
    return { name: 'viewer', version: '0.0.0' }
  }
}

const pkg = readPackageJson()

/** Nome do projeto. */
export const APP_NAME = 'Viewer'

/** Identificador interno (sem espaços, usado em arquivos/logs). */
export const APP_ID = 'viewer'

/** Versão instalada (SemVer). */
export const APP_VERSION = pkg.version || '0.0.0'

/** Diretório raiz do projeto. */
export const ROOT_DIR = rootDir

/** Versão do Node.js em execução. */
export const NODE_VERSION = process.versions.node

/** Usuário/agente de identificação usado no pairing (nunca exibe dados do aparelho). */
export const PAIRING_PLATFORM_DISPLAY = 'Viewer'

/**
 * Canais de lançamento conhecidos.
 * Apenas `stable` está ativo nesta versão; os demais permanecem preparados.
 */
export const RELEASE_CHANNELS = Object.freeze({
  stable: Object.freeze({ branch: 'main', active: true, label: 'Stable' }),
  beta: Object.freeze({ branch: 'beta', active: false, label: 'Beta' }),
  dev: Object.freeze({ branch: 'develop', active: false, label: 'Development' }),
})

/**
 * Prefixos de eventos internos do Viewer (contrato entre módulos).
 * Centralizado para evitar strings mágicas espalhadas.
 */
export const EVENTS = Object.freeze({
  STARTED: 'viewer:started',
  STOPPING: 'viewer:stopping',
  STOPPED: 'viewer:stopped',
  LOG_ENTRY: 'log:entry',
  CONNECTION_STATE: 'connection:state',
  CONNECTION_PAIRING: 'connection:pairing',
  CONNECTION_SOCKET: 'connection:socket',
  WA_MESSAGE: 'wa:message',
  WA_REACTION: 'wa:reaction',
  VO_DETECTED: 'viewer:viewonce:detected',
  RECOVERY_START: 'viewer:recovery:start',
  RECOVERY_DOWNLOAD_START: 'viewer:recovery:download:start',
  RECOVERY_DOWNLOAD_COMPLETE: 'viewer:recovery:download:complete',
  RECOVERY_SEND_START: 'viewer:recovery:send:start',
  RECOVERY_SEND_COMPLETE: 'viewer:recovery:send:complete',
  RECOVERY_COMPLETE: 'viewer:recovery:complete',
  RECOVERY_SKIPPED: 'viewer:recovery:skipped',
  RECOVERY_ERROR: 'viewer:recovery:error',
  STATS_UPDATED: 'stats:updated',
  NOTIFICATION: 'notification:new',
  PLUGINS_LOADED: 'plugins:loaded',
})
