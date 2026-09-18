/**
 * @file src/terminal/Dashboard.js
 * @module terminal/dashboard
 *
 * Painel profissional do Viewer.
 *
 * - Redesenha a tela inteira em intervalo configurável (sem flicker: cursor
 *   retorna ao início e as linhas são sobrescritas).
 * - Exibe: logo, versão, canal, Node/Baileys/WhatsApp, plataforma, status da
 *   conexão, tempo de atividade, CPU/RAM, contadores e logs recentes.
 * - Em saída não interativa (pipe/CI) o painel é desativado e os logs
 *   fluem normalmente pelo console.
 *
 * Privacidade: nenhum identificador de aparelho/localização é exibido.
 */

import os from 'node:os'
import { bus } from '../core/EventBus.js'
import { EVENTS, APP_NAME, APP_VERSION, NODE_VERSION, RELEASE_CHANNELS } from '../constants.js'
import { getBaileysVersion } from '../lib/baileys.js'
import { box, center, progressBar, formatBytes, truncate, ansi } from '../utils/text.js'
import { formatUptime, formatClock } from '../utils/time.js'
import { sampleProcessCpu, processMemory, platformLabel } from '../utils/system.js'
import { getTheme } from './theme.js'
import { LOGO } from './logo.js'
import { setConsoleSink, getRecentEntries } from '../logger/index.js'
import { t } from '../i18n/index.js'

const WIDTH = 62

export class Dashboard {
  /**
   * @param {object} deps Dependências.
   * @param {import('../config/Config.js').Config} deps.config Configuração.
   * @param {import('../connection/Connection.js').Connection} deps.connection Conexão.
   * @param {import('../stats/Stats.js').Stats} deps.stats Estatísticas.
   * @param {import('../cache/MessageCache.js').MessageCache} deps.cache Cache.
   */
  constructor({ config, connection, stats, cache }) {
    this.config = config
    this.connection = connection
    this.stats = stats
    this.cache = cache
    this.theme = getTheme(config.get('viewer.theme'))
    this.timer = null
    this.running = false
    this.prevLines = 0
    /** Código de pareamento em exibição (some ao conectar). @type {string|null} */
    this.pairingCode = null
    /** @type {{level:string, line:string}[]} */
    this.logBuffer = []
    this.maxLogLines = config.get('dashboard.logLines') || 8
  }

  /** @returns {boolean} `true` se o painel pode assumir a tela. */
  #canRender() {
    return Boolean(this.config.get('dashboard.enabled')) && Boolean(process.stdout.isTTY)
  }

  /** Inicia o painel (ou modo passivo quando a saída não é um terminal). */
  start() {
    bus.safeOn(EVENTS.LOG_ENTRY, (entry) => {
      // Com o painel ativo, os logs entram na área de registros do quadro
      // (o sink de console do logger fica desativado). Sem painel, o próprio
      // logger imprime — nada é escrito aqui para evitar duplicidade.
      if (!this.running) return
      this.pushLog(entry)
    })

    // O código de pareamento vive no painel enquanto não há confirmação.
    bus.safeOn(EVENTS.CONNECTION_PAIRING, ({ code }) => {
      this.pairingCode = code
      if (this.running) this.render()
    })
    bus.safeOn(EVENTS.CONNECTION_STATE, ({ state }) => {
      if (state === 'open') this.pairingCode = null
      if (this.running) this.render()
    })

    if (!this.#canRender()) return

    // Captura os logs emitidos antes do painel assumir a tela.
    for (const entry of getRecentEntries(this.maxLogLines)) this.pushLog(entry)

    this.running = true
    setConsoleSink(false)
    process.stdout.write(ansi.clearScreen + ansi.hideCursor)
    this.render()
    this.timer = setInterval(() => this.render(), this.config.get('dashboard.refreshMs'))
    this.timer.unref()
  }

  /**
   * Adiciona uma entrada à área de registros (com limite).
   * @param {{level: string, line: string}} entry Entrada de log.
   */
  pushLog(entry) {
    this.logBuffer.push(entry)
    if (this.logBuffer.length > this.maxLogLines) this.logBuffer.shift()
  }

  /** Encerra o painel devolvendo o terminal ao usuário. */
  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.running) {
      process.stdout.write(ansi.showCursor + '\n')
      this.running = false
      setConsoleSink(true)
    }
  }

  /** Rótulo de status da conexão com indicador colorido. */
  #statusLabel() {
    const { state } = this.connection.getStatus()
    const th = this.theme
    switch (state) {
      case 'open':
        return th.ok(`● ${t('status.open')}`)
      case 'pairing':
        return th.warn(`◌ ${t('status.waitingPairing')}`)
      case 'connecting':
        return th.warn(`◌ ${t('status.connecting')}`)
      default:
        return th.error(`○ ${t('status.close')}`)
    }
  }

  /**
   * Linha rotulada padronizada das caixas.
   * @param {string} label Rótulo.
   * @param {string} value Valor já formatado/colorido.
   * @returns {string}
   */
  #row(label, value) {
    return `${this.theme.label(label.padEnd(19))} ${value}`
  }

  /** Constrói e escreve um quadro completo. */
  render() {
    if (!this.running) return
    const th = this.theme
    const snap = this.stats.snapshot()
    const uptimeMs = Date.now() - snap.startedAt.getTime()
    const channel = RELEASE_CHANNELS[this.config.get('update.channel')]?.label ?? 'Stable'

    const lines = []

    // Cabeçalho: logo + identificação.
    for (const row of LOGO) lines.push('  ' + th.brand(row))
    lines.push(center(th.title(`${APP_NAME} — ${t('app.tagline')}`), WIDTH))
    lines.push(center(th.muted(`v${APP_VERSION} • ${t('dashboard.channel')}: ${channel}`), WIDTH))
    lines.push('')

    // Conexão.
    const connectionLines = [
      this.#row(t('dashboard.status'), this.#statusLabel()),
      this.#row(t('dashboard.uptime'), th.value(formatUptime(uptimeMs))),
      this.#row(t('dashboard.startedAt'), th.value(formatClock(snap.startedAt))),
    ]
    // Código de pareamento em destaque enquanto aguarda confirmação;
    // desaparece automaticamente quando a conexão abre.
    if (this.pairingCode) {
      connectionLines.push(this.#row(t('dashboard.pairingCode'), th.title(this.pairingCode)))
      connectionLines.push(
        this.#row(t('dashboard.pairingWhere'), th.warn('Aparelhos conectados → nº de telefone'))
      )
    }
    lines.push(...box(t('dashboard.connection'), connectionLines, WIDTH))

    // Sistema.
    const waVersion = this.connection.waVersion
      ? th.value(this.connection.waVersion)
      : th.muted('indisponível (offline)')
    lines.push(
      ...box(
        t('dashboard.system'),
        [
          this.#row(t('dashboard.node'), th.value(`v${NODE_VERSION}`)),
          this.#row(t('dashboard.baileys'), th.value(getBaileysVersion())),
          this.#row(t('dashboard.whatsapp'), waVersion),
          this.#row(t('dashboard.platform'), th.value(platformLabel())),
        ],
        WIDTH
      )
    )

    // Recursos (processo): CPU e RAM com barras.
    const cpu = sampleProcessCpu()
    const ram = processMemory()
    const ramRatio = Math.min(1, ram / os.totalmem())
    lines.push(
      ...box(
        t('dashboard.resources'),
        [
          this.#row(
            t('dashboard.cpu'),
            `${th.bar.filled(progressBar(cpu / 100, 18))} ${th.value(cpu.toFixed(1).padStart(5))}%`
          ),
          this.#row(
            t('dashboard.ram'),
            `${th.bar.filled(progressBar(ramRatio, 18))} ${th.value(formatBytes(ram).padStart(5))}`
          ),
        ],
        WIDTH
      )
    )

    // Atividade.
    lines.push(
      ...box(
        t('dashboard.activity'),
        [
          this.#row(t('dashboard.messages'), th.value(String(snap.session.messagesProcessed))),
          this.#row(t('dashboard.recovered'), th.ok(String(snap.session.mediaRecovered))),
          this.#row(
            t('dashboard.errors'),
            snap.session.errors ? th.error(String(snap.session.errors)) : th.value('0')
          ),
          this.#row(t('dashboard.cache'), th.value(`${this.cache.size} view once`)),
        ],
        WIDTH
      )
    )

    // Logs recentes.
    const logLines = this.logBuffer.map((entry) => {
      const paint = th.log[entry.level] ?? th.log.info
      return paint(truncate(entry.line, WIDTH - 6))
    })
    while (logLines.length < this.maxLogLines) logLines.push(th.muted('—'))
    lines.push(...box(t('dashboard.logs'), logLines, WIDTH))

    lines.push(center(th.muted('Ctrl+C para encerrar'), WIDTH))

    this.#write(lines)
  }

  /**
   * Escreve o quadro sobrescrevendo o anterior e limpando sobras.
   * @param {string[]} lines Linhas do quadro.
   */
  #write(lines) {
    let frame = ansi.home + lines.join('\n')
    if (lines.length < this.prevLines) {
      // Limpa linhas residuais de quadros maiores anteriores.
      frame +=
        '\n' +
        Array(this.prevLines - lines.length)
          .fill(ansi.clearLine)
          .join('\n')
      frame += ansi.up(this.prevLines - lines.length)
    }
    process.stdout.write(frame)
    this.prevLines = lines.length
  }
}
