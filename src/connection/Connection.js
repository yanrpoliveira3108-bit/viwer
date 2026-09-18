/**
 * @file src/connection/Connection.js
 * @module connection
 *
 * Gerenciador de conexão com o WhatsApp Multi Device via
 * boruto_vk7-baileys. Responsabilidades:
 *
 * - criar/recriar o socket (sessão multi-arquivo);
 * - fluxo de Pairing Code (código de pareamento);
 * - reconexão automática com backoff exponencial;
 * - publicação do estado no barramento interno de eventos.
 *
 * Privacidade: nada aqui coleta ou expõe identificadores do aparelho.
 */

import readline from 'node:readline'
import { api } from '../lib/baileys.js'
import { bus } from '../core/EventBus.js'
import { EVENTS } from '../constants.js'
import { createLogger } from '../logger/index.js'
import { sleep } from '../utils/time.js'
import { ensureDirSync } from '../utils/fs.js'
import { t } from '../i18n/index.js'

const log = createLogger('CONEXÃO')

/** Logger silencioso entregue à biblioteca (evita ruído do pino no painel). */
const quietLogger = {
  level: 'silent',
  child: () => quietLogger,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
}

export class Connection {
  /**
   * @param {object} deps Dependências.
   * @param {import('../config/Config.js').Config} deps.config Configuração.
   */
  constructor({ config }) {
    this.config = config
    /** @type {object|null} Socket ativo. */
    this.sock = null
    /** @type {'connecting'|'open'|'close'|'pairing'} */
    this.state = 'connecting'
    this.closeReason = null
    this.attempts = 0
    this.shouldReconnect = true
    this.waVersion = null
    this.auth = null
  }

  /** @returns {object|null} Socket conectado (ou em conexão). */
  getSocket() {
    return this.sock
  }

  /**
   * JID do próprio número conectado (destino das recuperações).
   * @returns {string|null}
   */
  getSelfJid() {
    const { jidNormalizedUser } = api()
    const id = this.sock?.user?.id
    return id ? jidNormalizedUser(id) : null
  }

  /** Estado atual para o Dashboard. @returns {object} */
  getStatus() {
    return { state: this.state, closeReason: this.closeReason, attempts: this.attempts }
  }

  /**
   * Inicializa a conexão (cria socket e registra listeners).
   * @returns {Promise<void>}
   */
  async start() {
    const { fetchLatestBaileysVersion } = api()
    try {
      // Timeout curto: sem rede o Viewer inicia mesmo assim.
      const { version } = await fetchLatestBaileysVersion({ timeout: 8000 })
      this.waVersion = String(version)
    } catch {
      this.waVersion = null // offline: o Dashboard mostrará "indisponível"
    }

    const { useMultiFileAuthState } = api()
    const sessionDir = this.config.resolvePath(this.config.get('connection.sessionDir'))
    ensureDirSync(sessionDir)
    this.auth = await useMultiFileAuthState(sessionDir)
    await this.#connect()
  }

  /** Cria um socket novo (primeira vez ou reconexão). */
  async #connect() {
    const { default: makeWASocket } = api()
    this.#setState('connecting')

    const browser = this.config.get('connection.browser')
    this.sock = makeWASocket({
      auth: this.auth.state,
      logger: quietLogger,
      printQRInTerminal: false,
      browser:
        Array.isArray(browser) && browser.length === 3 ? browser : ['Ubuntu', 'Viewer', '1.0.0'],
      markOnlineOnConnect: this.config.get('connection.markOnlineOnConnect'),
      syncFullHistory: this.config.get('connection.syncFullHistory'),
      version: this.waVersion ? this.waVersion.split('.').map(Number) : undefined,
    })

    this.#registerSocketEvents()
    // Notifica módulos interessados (registro de eventos WA, plugins).
    bus.emit(EVENTS.CONNECTION_SOCKET, { sock: this.sock })
  }

  /** Registra os eventos do socket atual. */
  #registerSocketEvents() {
    const sock = this.sock

    sock.ev.on('creds.update', async () => {
      try {
        await this.auth.saveCreds()
      } catch (error) {
        log.error(`falha ao salvar credenciais: ${error.message}`)
      }
    })

    sock.ev.on('connection.update', (update) => this.#onConnectionUpdate(update))
  }

  /**
   * Trata atualizações de conexão.
   * @param {{connection?: string, lastDisconnect?: object}} update
   */
  async #onConnectionUpdate(update) {
    const { connection, lastDisconnect } = update

    if (connection === 'open') {
      this.attempts = 0
      this.#setState('open')
      log.info(t('app.connected'))
      return
    }

    if (connection === 'connecting') {
      this.#setState('connecting')
      return
    }

    if (connection !== 'close') return

    const { DisconnectReason } = api()
    const statusCode = lastDisconnect?.error?.output?.statusCode
    this.#setState('close', statusCode)

    switch (statusCode) {
      case DisconnectReason.loggedOut:
        log.error(t('app.loggedOut'))
        this.shouldReconnect = false
        bus.emit(EVENTS.STOPPING, { reason: 'logged-out' })
        return

      case DisconnectReason.badSession:
        log.warn(
          'sessão inválida — será criada nova conexão (se persistir, apague a pasta de sessão)'
        )
        break

      case DisconnectReason.multideviceMismatch:
        log.warn('incompatibilidade multidevice — reparando a sessão pode ser necessário')
        break

      case DisconnectReason.restartRequired:
        log.info('reinicialização do socket solicitada pelo servidor')
        break

      default:
        log.info(`${t('app.disconnected')} (código ${statusCode ?? 'desconhecido'})`)
    }

    await this.#scheduleReconnect()
  }

  /** Reconecta com backoff exponencial limitado. */
  async #scheduleReconnect() {
    const enabled = this.config.get('connection.reconnect.enabled')
    const maxAttempts = this.config.get('connection.reconnect.maxAttempts')
    if (!enabled || !this.shouldReconnect) return
    if (maxAttempts > 0 && this.attempts >= maxAttempts) {
      log.error('limite de tentativas de reconexão atingido')
      this.shouldReconnect = false
      return
    }

    const base = this.config.get('connection.reconnect.baseDelayMs')
    const max = this.config.get('connection.reconnect.maxDelayMs')
    const delay = Math.min(base * 2 ** this.attempts, max)
    this.attempts += 1
    log.info(
      `${t('app.reconnecting')} (tentativa ${this.attempts} em ${Math.round(delay / 1000)}s)`
    )
    await sleep(delay)

    try {
      await this.#connect()
    } catch (error) {
      log.error(`falha ao reconectar: ${error.message}`)
      await this.#scheduleReconnect()
    }
  }

  /**
   * Fluxo de pareamento por código.
   * Executado apenas quando ainda não há sessão registrada.
   * @returns {Promise<void>}
   */
  async performPairingIfNeeded() {
    if (this.auth.state.creds.registered) {
      log.info(t('app.restoringSession'))
      return
    }

    this.#setState('pairing')
    log.info(t('app.generatingPairing'))

    let phone = String(this.config.get('connection.phoneNumber') || '').replace(/\D/g, '')
    if (!phone) {
      phone = await this.#promptPhoneNumber()
    }
    if (!phone || phone.length < 8) {
      throw new Error('número de telefone inválido para o Pairing Code')
    }

    // O websocket precisa estar aberto antes de solicitar o código.
    await this.#waitForWebsocket()

    // Código personalizado (config) ou aleatório (null força aleatório no fork).
    const custom = String(this.config.get('connection.customPairingCode') || '').trim()
    const code = await this.sock.requestPairingCode(phone, custom || null)

    const pretty = `${code.slice(0, 4)}-${code.slice(4)}`
    log.info(`${t('app.pairingCodeTitle')}: ${pretty}`)
    log.info(t('app.pairingHelp'))
    log.info(t('app.waitingAuth'))
    bus.emit(EVENTS.CONNECTION_PAIRING, { code: pretty })
  }

  /**
   * Aguarda o websocket abrir (necessário antes do requestPairingCode).
   * @param {number} [timeoutMs=30000] Tempo máximo de espera.
   * @throws {Error} Quando a conexão não abre a tempo.
   */
  async #waitForWebsocket(timeoutMs = 30000) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const state = this.sock?.ws?.readyState
      if (state === 1) return // WebSocket.OPEN
      if (state === 2 || state === 3) break // CLOSING/CLOSED
      await sleep(150)
    }
    throw new Error('não foi possível conectar ao WhatsApp para gerar o Pairing Code')
  }

  /**
   * Pergunta o número no terminal (apenas quando não configurado).
   * @returns {Promise<string>} Somente dígitos.
   */
  async #promptPhoneNumber() {
    if (!process.stdin.isTTY) {
      throw new Error(
        'defina connection.phoneNumber no viewer.config.json para parear sem terminal interativo'
      )
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    try {
      const answer = await new Promise((resolve) => {
        rl.question(`\n${t('app.pairingPrompt')} `, resolve)
      })
      return answer.replace(/\D/g, '')
    } finally {
      rl.close()
    }
  }

  /**
   * Publica e registra o estado da conexão.
   * @param {string} state Estado.
   * @param {number|null} [statusCode] Código de desconexão.
   */
  #setState(state, statusCode = null) {
    this.state = state
    this.closeReason = statusCode
    bus.emit(EVENTS.CONNECTION_STATE, { state, statusCode })
  }

  /** Encerra a conexão (shutdown gracioso). */
  async close() {
    this.shouldReconnect = false
    try {
      this.sock?.end(new Error('viewer-shutdown'))
    } catch {
      /* socket já encerrado */
    }
  }
}
