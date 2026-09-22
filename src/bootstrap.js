/**
 * @file src/bootstrap.js
 * @module bootstrap
 *
 * Orquestra a inicialização do Viewer na ordem correta e mantém o núcleo
 * pequeno: cada módulo é criado e ligado aqui, sem lógica de negócio.
 *
 * Sequência:
 *   Inicializando → Verificando dependências → Carregando módulos →
 *   Carregando plugins → Preparando conexão → Pairing/Sessão → Dashboard
 */

import { bus } from './core/EventBus.js'
import { EVENTS, APP_NAME, APP_VERSION, ROOT_DIR } from './constants.js'
import { announce } from './terminal/banner.js'
import { Dashboard } from './terminal/Dashboard.js'
import { loadConfig } from './config/Config.js'
import { configureLogger, createLogger, closeLogger } from './logger/index.js'
import { Database } from './database/Database.js'
import { Stats } from './stats/Stats.js'
import { MessageCache } from './cache/MessageCache.js'
import { RecoveryPipeline } from './viewer/pipeline.js'
import { registerEventBridge } from './events/index.js'
import { Connection } from './connection/Connection.js'
import { PluginLoader } from './plugins/PluginLoader.js'
import { MenuManager } from './menu/index.js'
import { getBaileys, getBaileysVersion } from './lib/baileys.js'
import { ensureDir } from './utils/fs.js'
import { setLanguage, t } from './i18n/index.js'
import path from 'node:path'

const log = createLogger('NÚCLEO')

/** Estado compartilhado do ciclo de vida (mutável durante o boot). */
const runtime = {
  config: null,
  db: null,
  cache: null,
  stats: null,
  pipeline: null,
  connection: null,
  dashboard: null,
  menu: null,
  stopping: false,
}

/**
 * Inicia o Viewer. Resolve apenas quando o sistema está operacional
 * (o processo permanece vivo pelo socket e pelo painel).
 * @returns {Promise<void>}
 */
export async function bootstrap() {
  announce(`${APP_NAME} v${APP_VERSION} — ${t('app.starting')}`)

  registerSafetyNets()
  bus.safeOn('viewer:internal-error', ({ event, error }) => {
    log.error(`erro interno em handler de "${event}": ${error?.message}`)
  })

  // ── Verificando dependências ────────────────────────────────────────────
  announce(t('app.checkingDependencies'), 'pending')
  getBaileys() // lança erro claro se a biblioteca estiver ausente/quebrada
  announce(`${t('app.checkingDependencies')} (Baileys ${getBaileysVersion()})`)

  // ── Carregando módulos ──────────────────────────────────────────────────
  announce(t('app.loadingModules'), 'pending')
  runtime.config = await loadConfig()
  const config = runtime.config
  setLanguage(config.get('viewer.language'))
  configureLogger(config.get('logs'))

  for (const dirKey of ['connection.sessionDir', 'media.tempDir', 'logs.dir', 'database.file']) {
    const value = config.get(dirKey)
    const target =
      dirKey === 'database.file'
        ? path.dirname(config.resolvePath(value))
        : config.resolvePath(value)
    await ensureDir(target)
  }

  runtime.db = new Database({
    file: config.resolvePath(config.get('database.file')),
    saveIntervalMs: config.get('database.saveIntervalMs'),
  })
  await runtime.db.load()
  runtime.db.start()

  runtime.stats = new Stats({ db: runtime.db, persist: config.get('stats.persist') })

  runtime.cache = new MessageCache({
    maxEntries: config.get('cache.maxEntries'),
    ttlMs: config.get('cache.ttlMinutes') * 60 * 1000,
    sweepIntervalMs: config.get('cache.sweepIntervalSeconds') * 1000,
  })

  announce(t('app.loadingModules'))

  // ── Preparando conexão ──────────────────────────────────────────────────
  announce(t('app.preparingConnection'), 'pending')
  runtime.connection = new Connection({ config })

  runtime.pipeline = new RecoveryPipeline({
    cache: runtime.cache,
    stats: runtime.stats,
    config,
    getSocket: () => runtime.connection.getSocket(),
    getSelfJid: () => runtime.connection.getSelfJid(),
  })

  registerEventBridge({
    pipeline: runtime.pipeline,
    cache: runtime.cache,
    stats: runtime.stats,
    config,
  })
  announce(t('app.preparingConnection'))

  // ── Carregando plugins ──────────────────────────────────────────────────
  announce(t('app.loadingPlugins'), 'pending')
  const plugins = new PluginLoader({ config })
  await plugins.loadAll()
  announce(t('app.loadingPlugins'))

  // Menu interativo: preparado, inativo nesta versão.
  runtime.menu = new MenuManager({ config, stats: runtime.stats })

  // ── Conectando ──────────────────────────────────────────────────────────
  // O número do pareamento é resolvido ANTES do socket existir (sem disputa
  // entre prompt e ciclo de vida da conexão); o código é pedido no momento
  // certo e repetido automaticamente nas reconexões.
  await runtime.connection.preparePairing()
  await runtime.connection.start()

  // Dashboard assume a tela após o fluxo de pareamento/sessão.
  runtime.dashboard = new Dashboard({
    config,
    connection: runtime.connection,
    stats: runtime.stats,
    cache: runtime.cache,
  })
  runtime.dashboard.start()

  bus.emit(EVENTS.STARTED, { startedAt: runtime.stats.startedAt, root: ROOT_DIR })
  log.info('sistema operacional')
}

/**
 * Encerramento gracioso (Ctrl+C, sinal do sistema, logout).
 * @param {string} reason Motivo registrado em log.
 */
export async function shutdown(reason = 'sinal recebido') {
  if (runtime.stopping) return
  runtime.stopping = true
  bus.emit(EVENTS.STOPPING, { reason })
  log.info(`${t('app.shutdown')} (${reason})`)

  try {
    runtime.dashboard?.stop()
    await runtime.menu?.stop()
    await runtime.connection?.close()
    runtime.cache?.close()
    runtime.db?.close()
  } catch (error) {
    log.error(`erro durante encerramento: ${error.message}`)
  }

  bus.emit(EVENTS.STOPPED)
  closeLogger()
  // Pequena espera para o socket encerrar a conexão de forma limpa.
  setTimeout(() => process.exit(0), 300).unref()
}

/** Proteções globais: nenhuma exceção derruba o Viewer. */
function registerSafetyNets() {
  process.on('uncaughtException', (error) => {
    log.error(`exceção não capturada contida: ${error?.message}`)
  })
  process.on('unhandledRejection', (reason) => {
    log.error(
      `rejeição não tratada contida: ${reason instanceof Error ? reason.message : String(reason)}`
    )
  })
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  // Requisição de parada vinda de dentro (ex.: sessão expirada).
  bus.safeOn(EVENTS.STOPPING, ({ reason }) => {
    if (reason === 'logged-out') void shutdown('sessão encerrada')
  })
}
