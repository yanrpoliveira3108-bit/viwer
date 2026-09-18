/**
 * @file src/connection/Connection.js
 * @module connection
 *
 * Gerenciador de conexão com o WhatsApp Multi Device via
 * boruto_vk7-baileys. Responsabilidades:
 *
 * - criar/recriar o socket (sessão multi-arquivo);
 * - fluxo de Pairing Code robusto (número resolvido ANTES do socket,
 *   pedido de código com handshake concluído, repetição em reconexões);
 * - resolução da versão do WhatsApp com cadeia de fontes e fallback
 *   registrado em log (a biblioteca embute uma versão que pode ficar
 *   defasada — o servidor rejeita clientes antigos);
 * - reconexão automática com backoff exponencial;
 * - publicação do estado no barramento interno de eventos.
 *
 * Privacidade: nada aqui coleta ou expõe identificadores do aparelho.
 */

import readline from 'node:readline'
import { api, getBundledWaVersion } from '../lib/baileys.js'
import { bus } from '../core/EventBus.js'
import { EVENTS } from '../constants.js'
import { createLogger } from '../logger/index.js'
import { sleep } from '../utils/time.js'
import { ensureDirSync } from '../utils/fs.js'
import { t } from '../i18n/index.js'

const log = createLogger('CONEXÃO')

/** Máximo de tentativas de pareamento antes de orientar o usuário. */
const MAX_PAIRING_ATTEMPTS = 3

/** Espera para o handshake de registro terminar antes do pedido de código. */
const PAIRING_GRACE_MS = 1500

/**
 * Fontes da versão mais recente do WhatsApp, em ordem de preferência.
 *
 * IMPORTANTE: o servidor do WhatsApp rejeita versões defasadas (erro 405).
 * A fonte do fork (Itsukichann) está congelada, por isso a fonte mantida
 * ativamente (WhiskeySockets) vem primeiro; o endpoint oficial do
 * WhatsApp Web cobre bloqueios ao GitHub.
 */
const VERSION_SOURCES = [
  {
    name: 'repositório mantido',
    url: 'https://api.github.com/repos/WhiskeySockets/Baileys/contents/src/Defaults/baileys-version.json',
    extract: (data) => JSON.parse(Buffer.from(data.content, 'base64').toString('utf8')).version,
  },
  {
    name: 'atualização oficial do WhatsApp Web',
    url: 'https://web.whatsapp.com/check-update?version=2.3000.1000000000&platform=web',
    extract: (data) =>
      String(data?.currentVersion ?? '')
        .split('.')
        .map(Number),
  },
  {
    name: 'fork oficial',
    url: 'https://raw.githubusercontent.com/Itsukichann/Baileys/refs/heads/master/lib/Defaults/baileys-version.json',
    extract: (data) => data?.version,
  },
]

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

/**
 * Valida o formato de uma versão do WhatsApp.
 * @param {unknown} version Candidata.
 * @returns {number[]|null} Tripla numérica ou `null`.
 */
function isValidWaVersion(version) {
  return Array.isArray(version) && version.length === 3 && version.every((n) => Number.isFinite(n))
    ? version.map(Number)
    : null
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
    this.pairingAttempts = 0
    this.shouldReconnect = true
    this.waVersion = null
    this.waVersionSource = null
    this.auth = null
    /** Número preparado para o pareamento (antes do socket existir). */
    this.pairingPhone = null
    this.pairingInFlight = false
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
   * Etapa 1 do pareamento: resolve o número ANTES de criar o socket,
   * evitando disputa entre o prompt e o ciclo de vida da conexão.
   * @returns {Promise<void>}
   */
  async preparePairing() {
    const sessionDir = this.config.resolvePath(this.config.get('connection.sessionDir'))
    ensureDirSync(sessionDir)
    const { useMultiFileAuthState } = api()
    this.auth = await useMultiFileAuthState(sessionDir)

    if (this.auth.state.creds.registered) {
      log.info(t('app.restoringSession'))
      return
    }

    // Sessão parcialmente registrada (pareamento interrompido) é reiniciada:
    // sem isso, o fork tentaria "login" com identidade nunca pareada.
    if (this.auth.state.creds.me) {
      this.auth.state.creds.me = undefined
      await this.auth.saveCreds()
      log.info('pareamento anterior incompleto detectado — sessão reiniciada')
    }

    let phone = String(this.config.get('connection.phoneNumber') || '').replace(/\D/g, '')
    if (!phone) phone = await this.#promptPhoneNumber()
    if (!phone || phone.length < 8) {
      throw new Error('número de telefone inválido para o Pairing Code')
    }
    this.pairingPhone = phone
  }

  /**
   * Etapa 2: inicializa a conexão (resolução de versão + socket).
   * @returns {Promise<void>}
   */
  async start() {
    await this.#resolveWaVersion()
    await this.#connect()
  }

  /**
   * Resolve a versão do WhatsApp a ser anunciada ao servidor.
   * Consulta todas as fontes em paralelo e usa a MAIOR versão válida
   * (o servidor rejeita versões defasadas — erro 405). Se nada estiver
   * acessível, usa a versão embutida na biblioteca com aviso.
   * Cada decisão é registrada em log; nunca interrompe a inicialização.
   */
  async #resolveWaVersion() {
    const results = await Promise.allSettled(
      VERSION_SOURCES.map(async (source) => {
        const response = await fetch(source.url, { signal: AbortSignal.timeout(8000) })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const version = isValidWaVersion(source.extract(await response.json()))
        if (!version) throw new Error('formato inesperado')
        return { source: source.name, version }
      })
    )

    let best = null
    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      if (!best || result.value.version[2] > best.version[2]) best = result.value
    }

    if (best) {
      this.waVersion = best.version.join('.')
      this.waVersionSource = best.source
      log.info(`versão do WhatsApp: ${this.waVersion} (${best.source})`)
      return
    }

    const bundled = isValidWaVersion(getBundledWaVersion())
    if (bundled) {
      this.waVersion = bundled.join('.')
      this.waVersionSource = 'embalada na biblioteca'
      log.warn(
        `sem acesso às versões atualizadas — usando a versão embutida (${this.waVersion}). ` +
          'Se a conexão for recusada pelo WhatsApp (405), verifique sua internet.'
      )
      return
    }
    this.waVersion = null
    this.waVersionSource = null
    log.warn('não foi possível determinar a versão do WhatsApp; usando padrão da biblioteca')
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

    this.#armOpenWatchdog()

    // Pareamento: dispara para cada socket novo enquanto não registrado.
    if (!this.auth.state.creds.registered && this.pairingPhone) {
      void this.#attemptPairing()
    }
  }

  /**
   * Vigia de abertura: se o websocket não abrir em 30s (rede instável,
   * bloqueio temporário etc.), derruba o socket para o backoff de
   * reconexão agir — evita ficar preso em "Conectando" para sempre.
   */
  #armOpenWatchdog() {
    const sock = this.sock
    const timer = setTimeout(() => {
      if (this.sock !== sock) return // socket já substituído
      if (this.state === 'open' || this.auth.state.creds.registered) return
      const rawState = sock?.ws?.socket?.readyState ?? sock?.ws?.readyState
      if (sock?.ws?.isOpen || rawState === 1) return // aberto (aguardando pareamento)
      log.warn('a conexão não abriu em 30s — encerrando para tentar novamente')
      try {
        sock?.end(new Error('connect-timeout'))
      } catch {
        /* socket já encerrado */
      }
    }, 30000)
    timer.unref()
  }

  /**
   * Pede o Pairing Code no socket atual.
   * Aguarda o websocket abrir + o handshake de registro assentar, e trata
   * falhas sem derrubar o processo (a reconexão tentará de novo).
   */
  async #attemptPairing() {
    if (this.pairingInFlight) return
    this.pairingInFlight = true
    try {
      this.#setState('pairing')
      log.info(t('app.generatingPairing'))

      await this.#waitForWebsocket()
      // Deixa o registro inicial concluir antes do pedido de código.
      await sleep(PAIRING_GRACE_MS)
      if (this.auth.state.creds.registered) return

      if (this.pairingAttempts >= MAX_PAIRING_ATTEMPTS) {
        log.error(
          'número máximo de tentativas de pareamento atingido. ' +
            'Verifique data/hora do aparelho e a conexão; depois execute novamente.'
        )
        this.shouldReconnect = false
        return
      }
      this.pairingAttempts += 1

      const custom = String(this.config.get('connection.customPairingCode') || '').trim()
      const code = await this.sock.requestPairingCode(this.pairingPhone, custom || null)

      const pretty = `${code.slice(0, 4)}-${code.slice(4)}`
      log.info(`${t('app.pairingCodeTitle')}: ${pretty}`)
      log.info(t('app.pairingHelp'))
      log.info(t('app.waitingAuth'))
      bus.emit(EVENTS.CONNECTION_PAIRING, { code: pretty })
    } catch (error) {
      log.warn(
        `pedido de pareamento falhou (${error?.message ?? 'socket indisponível'}); ` +
          'nova tentativa na próxima conexão'
      )
    } finally {
      this.pairingInFlight = false
    }
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
      this.pairingAttempts = 0
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
        log.warn('incompatibilidade multidevice — reparar a sessão pode ser necessário')
        break

      case DisconnectReason.restartRequired:
        log.info('reinicialização do socket solicitada pelo servidor')
        break

      case 405:
        // Rejeição do servidor ao cliente (versão/registro/pedido recusado).
        if (!this.auth.state.creds.registered) {
          log.warn('conexão recusada pelo WhatsApp durante o pareamento — nova tentativa agendada')
        } else {
          log.warn('conexão recusada pelo WhatsApp (405)')
        }
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
   * Aguarda o websocket abrir (necessário antes do requestPairingCode).
   * @param {number} [timeoutMs=30000] Tempo máximo de espera.
   * @throws {Error} Quando a conexão não abre a tempo.
   */
  async #waitForWebsocket(timeoutMs = 30000) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      if (this.auth?.state?.creds?.registered) return
      // O wrapper do fork expõe isOpen/isClosed; o readyState bruto fica
      // no socket interno (ws.readyState não existe no wrapper).
      const ws = this.sock?.ws
      const rawState = ws?.socket?.readyState ?? ws?.readyState
      if (ws?.isOpen || rawState === 1) return
      if (ws?.isClosed || rawState === 3) {
        // Socket atual morreu: espera a reconexão criar outro.
        await sleep(400)
        continue
      }
      await sleep(150)
    }
    throw new Error('websocket não abriu a tempo para o pareamento')
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
