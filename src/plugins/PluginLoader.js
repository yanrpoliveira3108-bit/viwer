/**
 * @file src/plugins/PluginLoader.js
 * @module plugins
 *
 * Sistema de plugins do Viewer.
 *
 * Princípios:
 * - carregamento automático do diretório configurado (`plugins/*.js`);
 * - cada plugin exporta `default { name, version?, register(context) }`;
 * - falha em um plugin JAMAIS interrompe o sistema (isolamento total);
 * - plugins interagem apenas pelo barramento de eventos e pelo contexto
 *   mínimo entregue no registro (sem acesso a módulos internos).
 *
 * Contexto entregue ao plugin:
 *   { bus, logger, config: { get }, appVersion }
 */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { bus } from '../core/EventBus.js'
import { EVENTS, APP_VERSION } from '../constants.js'
import { createLogger } from '../logger/index.js'

const log = createLogger('PLUGINS')

export class PluginLoader {
  /**
   * @param {object} deps Dependências.
   * @param {import('../config/Config.js').Config} deps.config Configuração.
   */
  constructor({ config }) {
    this.config = config
    /** @type {{name: string, version?: string}[]} */
    this.loaded = []
  }

  /**
   * Carrega todos os plugins do diretório configurado.
   * @returns {Promise<number>} Quantidade de plugins carregados.
   */
  async loadAll() {
    if (!this.config.get('plugins.enabled')) {
      log.info('plugins desativados pela configuração')
      return 0
    }

    const dir = this.config.resolvePath(this.config.get('plugins.dir'))
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
      log.info('nenhum plugin encontrado')
      return 0
    }

    const files = fs
      .readdirSync(dir)
      .filter((file) => file.endsWith('.js'))
      .sort()

    for (const file of files) {
      await this.#loadOne(path.join(dir, file))
    }

    log.info(
      this.loaded.length
        ? `${this.loaded.length} plugin(s) carregado(s)`
        : 'nenhum plugin encontrado'
    )
    bus.emit(EVENTS.PLUGINS_LOADED, { count: this.loaded.length })
    return this.loaded.length
  }

  /**
   * Carrega um plugin isolando qualquer falha.
   * @param {string} file Caminho absoluto do arquivo.
   */
  async #loadOne(file) {
    const name = path.basename(file, '.js')
    try {
      const moduleUrl = pathToFileURL(file).href
      const mod = await import(`${moduleUrl}?t=${Date.now()}`)
      const plugin = mod.default

      if (!plugin || typeof plugin.register !== 'function') {
        log.warn(`plugin "${name}" ignorado: precisa exportar default com register(context)`)
        return
      }

      const context = Object.freeze({
        bus,
        logger: createLogger(`PLUGIN:${plugin.name ?? name}`),
        config: Object.freeze({ get: (key) => this.config.get(key) }),
        appVersion: APP_VERSION,
      })

      plugin.register(context)
      this.loaded.push({ name: plugin.name ?? name, version: plugin.version })
      log.info(
        `plugin carregado: ${plugin.name ?? name}${plugin.version ? ` v${plugin.version}` : ''}`
      )
    } catch (error) {
      // Isolamento: o restante do sistema segue sem o plugin com defeito.
      log.error(`falha ao carregar plugin "${name}" (isolada): ${error.message}`)
    }
  }
}
