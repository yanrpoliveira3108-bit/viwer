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
import { randomBytes } from 'node:crypto'
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

/** Tempo máximo aguardando o servidor aceitar o registro inicial. */
const REGISTRATION_ACK_TIMEOUT_MS = 10000

/** Assentamento após o reconhecimento do registro, antes de pedir o código. */
const POST_ACK_SETTLE_MS = 500

/** Validade aproximada do código exibido pelo WhatsApp no celular. */
const PAIRING_CODE_TTL_MS = 70000

/**
 * Normaliza um número de telefone brasileiro para o formato internacional
 * exigido pelo pareamento (somente dígitos, DDI + DDD + número).
 * @param {string} raw Entrada bruta do usuário/configuração.
 * @returns {{digits: string|null, notes: string[]}}
 */
export function normalizeBrPhoneNumber(raw) {
  const notes = []
  let digits = String(raw ?? '').replace(/\D/g, '')
  if (!digits) return { digits: null, notes: ['número vazio'] }

  // Prefixo de tronco nacional (0) antes do DDD não faz parte do número.
  if (/^0+/.test(digits)) {
    digits = digits.replace(/^0+/, '')
    notes.push('prefixo 0 inicial removido')
  }

  if (!digits.startsWith('55')) {
    if (digits.length === 10 || digits.length === 11) {
      digits = `55${digits}`
      notes.push('DDI 55 (Brasil) adicionado automaticamente')
    } else {
      // Já veio com DDI de outro país: o pareamento do Viewer é BR.
      return { digits: null, notes: ['use o DDI 55 + DDD + número'] }
    }
  }

  const local = digits.slice(2) // DDD + número
  const firstOfNumber = local[2] // primeiro dígito do número (após o DDD)
  if (local.length === 11) {
    // Celular brasileiro sempre começa em 9 (nono dígito).
    if (firstOfNumber !== '9') {
      return { digits: null, notes: ['celular com 11 dígitos deve começar com 9 após o DDD'] }
    }
  } else if (local.length === 10) {
    // Fixo começa em 2–5; começando em 9 é quase sempre celular digitado
    // sem o nono dígito — recusar evita parear o número errado.
    if (!/^[2-5]/.test(firstOfNumber ?? '')) {
      return { digits: null, notes: ['faltou o 9 do celular ou o DDD está errado'] }
    }
    notes.push('número fixo (8 dígitos) — o WhatsApp normalmente usa celular com 9')
  } else {
    return { digits: null, notes: ['quantidade de dígitos inesperada'] }
  }

  return { digits, notes }
}

/**
 * Formata para exibição humana: +55 (19) 91234-5678.
 * @param {string} digits Somente dígitos (12–13).
 * @returns {string}
 */
function formatBrPhone(digits) {
  const ddi = digits.slice(0, 2)
  const ddd = digits.slice(2, 4)
  const local = digits.slice(4)
  const tail =
    local.length === 9
      ? `${local.slice(0, 5)}-${local.slice(5)}`
      : `${local.slice(0, 4)}-${local.slice(4)}`
  return `+${ddi} (${ddd}) ${tail}`
}

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
    /** Número formatado para exibição/confirmação. @type {string|null} */
    this.pairingPhonePretty = null
    this.pairingInFlight = false
    /** Socket para o qual o código já foi publicado (1 pedido por sessão). */
    this.codePublishedForSocket = null
    /** Timer de expiração do código em exibição. @type {NodeJS.Timeout|null} */
    this.pairingExpiryTimer = null
    /** Servidor já reconheceu o registro inicial desta sessão? */
    this.registrationAcked = false
    /** @type {Array<() => void>} Resolvedores aguardando o reconhecimento. */
    this.regAckWaiters = []
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

    let phone = String(this.config.get('connection.phoneNumber') || '')
      .replace(/\s+/g, ' ')
      .trim()
    let normalized = normalizeBrPhoneNumber(phone)
    if (!normalized.digits) phone = await this.#promptPhoneNumber()
    normalized = normalizeBrPhoneNumber(phone)
    if (!normalized.digits) {
      throw new Error(
        `número de telefone inválido (${normalized.notes.join('; ')}) — ` +
          'use DDI+DDD+número (ex.: 5519912345678 ou 19 91234-5678)'
      )
    }
    if (normalized.notes.length) log.info(`número ajustado: ${normalized.notes.join('; ')}`)

    this.pairingPhone = normalized.digits
    this.pairingPhonePretty = formatBrPhone(normalized.digits)

    // O código é vinculado ao número EXATO pelo servidor do WhatsApp; um
    // dígito errado gera "não foi possível conectar o dispositivo". Por isso
    // o número resolvido é exibido e confirmado antes de criar o socket.
    log.info(`número que será pareado: ${this.pairingPhonePretty}`)
    if (!(await this.#confirmPhoneNumber())) {
      throw new Error('pareamento cancelado pelo usuário (número não confirmado)')
    }
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
    this.#clearPairingExpiry()
    this.registrationAcked = false

    // Sem sessão registrada, o handshake PRECISA seguir o caminho de
    // registro; creds.me residual (de tentativa de pareamento anterior)
    // faria o fork tentar login com identidade nunca pareada.
    if (!this.auth.state.creds.registered && this.auth.state.creds.me) {
      this.auth.state.creds.me = undefined
    }

    // browser[1] precisa ser um nome de plataforma conhecido do protocolo
    // (o fork converte em DeviceProps.PlatformType; "Viewer" viraria
    // UNKNOWN). Mantém identificação neutra e compatível.
    const browser = this.config.get('connection.browser')
    this.sock = makeWASocket({
      auth: this.auth.state,
      logger: quietLogger,
      printQRInTerminal: false,
      browser:
        Array.isArray(browser) && browser.length === 3 ? browser : ['Ubuntu', 'Chrome', '120.0.0'],
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
   * Gera um código de pareamento novo (8 caracteres). O fork usa um código
   * fixo como padrão ("ZEROBETA"), que colidiria entre sessões; por isso o
   * Viewer SEMPRE fornece o próprio código.
   * @returns {string}
   */
  #generatePairingCode() {
    const { bytesToCrockford } = api()
    return bytesToCrockford(randomBytes(5)).toUpperCase()
  }

  /**
   * Pede o Pairing Code no socket atual.
   * Aguarda o websocket abrir + o handshake de registro assentar, e trata
   * falhas sem derrubar o processo (a reconexão tentará de novo).
   *
   * Regras de segurança da sessão de pareamento:
   * - um pedido por socket (pedidos repetidos na mesma sessão conflitam);
   * - código NOVO a cada sessão nova (o código fica vinculado à identidade
   *   efêmera do socket; reutilizá-lo após reconexão gera sessão órfã e o
   *   celular responde "não foi possível conectar o dispositivo");
   * - código expirado (~60s no celular) renova a sessão automaticamente.
   */
  async #attemptPairing() {
    if (this.pairingInFlight) return
    if (this.codePublishedForSocket === this.sock) return
    this.pairingInFlight = true
    try {
      this.#setState('pairing')
      log.info(t('app.generatingPairing'))

      await this.#waitForWebsocket()
      // Espera o servidor ACEITAR o registro inicial (IQ pair-device).
      // Pedir o código antes disso faz o servidor descartar o pedido e o
      // celular responde "não foi possível conectar o dispositivo".
      const acked = await this.#waitForRegistrationAck(REGISTRATION_ACK_TIMEOUT_MS)
      if (this.auth.state.creds.registered) return
      if (this.codePublishedForSocket === this.sock) return
      if (!acked) {
        log.warn('o servidor não confirmou o registro em 10s — pedindo o código mesmo assim')
      } else {
        await sleep(POST_ACK_SETTLE_MS)
      }

      if (this.pairingAttempts >= MAX_PAIRING_ATTEMPTS) {
        log.error(
          'número máximo de tentativas de pareamento atingido. ' +
            'Verifique data/hora do aparelho e a conexão; depois execute novamente.'
        )
        this.shouldReconnect = false
        return
      }
      this.pairingAttempts += 1

      const code = await this.sock.requestPairingCode(
        this.pairingPhone,
        this.#generatePairingCode()
      )
      this.codePublishedForSocket = this.sock
      const pretty = `${code.slice(0, 4)}-${code.slice(4)}`
      log.info(`${t('app.pairingCodeTitle')}: ${pretty}`)
      log.info(`confira o número no celular: ${this.pairingPhonePretty}`)
      log.info(t('app.pairingHelp'))
      log.info(t('app.waitingAuth'))
      // O fork emite 'connecting' depois que já marcamos 'pairing'; restaura
      // o estado para o painel exibir "Aguardando pareamento".
      this.#setState('pairing')
      bus.emit(EVENTS.CONNECTION_PAIRING, { code: pretty, phone: this.pairingPhonePretty })
      this.#armPairingExpiry()
    } catch (error) {
      log.warn(
        `pedido de pareamento falhou (${error?.message ?? 'socket indisponível'}); ` +
          'nova tentativa na próxima conexão'
      )
    } finally {
      this.pairingInFlight = false
    }
  }

  /**
   * Renova a sessão de pareamento quando o código expira sem confirmação:
   * encerra o socket atual (a reconexão cria registro novo + código novo).
   */
  #armPairingExpiry() {
    this.#clearPairingExpiry()
    const sock = this.sock
    this.pairingExpiryTimer = setTimeout(() => {
      if (this.sock !== sock) return
      if (this.state === 'open' || this.auth.state.creds.registered) return
      log.warn('o código expirou sem confirmação — gerando nova sessão e novo código')
      this.pairingAttempts = 0 // expiração é inatividade do usuário, não falha
      try {
        sock?.end(new Error('pairing-code-expired'))
      } catch {
        /* socket já encerrado */
      }
    }, PAIRING_CODE_TTL_MS)
    this.pairingExpiryTimer.unref()
  }

  /** Cancela o timer de expiração do código. */
  #clearPairingExpiry() {
    if (this.pairingExpiryTimer) {
      clearTimeout(this.pairingExpiryTimer)
      this.pairingExpiryTimer = null
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

    // Diagnóstico do pareamento: o fork envia os IQs sem aguardar resposta,
    // então recusas do servidor ficariam invisíveis. Aqui resumimos cada
    // resposta recebida enquanto a sessão ainda não está registrada.
    sock.ws.on('CB:iq', (stanza) => this.#onServerIq(stanza))

    sock.ev.on('connection.update', (update) => this.#onConnectionUpdate(update))
  }

  /**
   * Resume e registra as respostas do servidor durante o pareamento.
   * A chegada do IQ `pair-device` significa que o registro inicial foi
   * aceito — só depois disso o pedido de código tem sessão válida.
   * @param {{attrs?: object, content?: unknown}} stanza Estância recebida.
   */
  #onServerIq(stanza) {
    try {
      if (this.auth.state.creds.registered) return
      const attrs = stanza?.attrs ?? {}
      const children = Array.isArray(stanza?.content) ? stanza.content.map((c) => c?.tag) : []
      const summary = `iq type=${attrs.type ?? '?'} filhos=[${children.join(',') || 'vazio'}]`

      if (attrs.type === 'error' || attrs.error) {
        log.warn(`servidor RECUSOU ${summary}${attrs.error ? ` (erro=${attrs.error})` : ''}`)
        return
      }
      if (children.includes('pair-device')) {
        log.info('registro aceito pelo servidor')
        this.#resolveRegistrationAck()
        return
      }
      if (children.includes('link_code_companion_reg')) {
        log.info(`servidor respondeu ao pareamento (${summary})`)
        this.#resolveRegistrationAck()
        return
      }
      if (children.includes('pair-success')) {
        log.info('pareamento confirmado pelo servidor')
        return
      }
      if (attrs.type === 'result') {
        log.info(`servidor confirmou ${summary}`)
      }
    } catch {
      /* diagnóstico nunca pode quebrar o pareamento */
    }
  }

  /** Libera quem aguarda o reconhecimento do registro. */
  #resolveRegistrationAck() {
    if (this.registrationAcked) return
    this.registrationAcked = true
    for (const resolve of this.regAckWaiters.splice(0)) resolve()
  }

  /**
   * Aguarda o servidor aceitar o registro inicial desta sessão.
   * @param {number} timeoutMs Tempo máximo de espera (segue mesmo sem ack).
   * @returns {Promise<boolean>} `true` se o reconhecimento chegou a tempo.
   */
  #waitForRegistrationAck(timeoutMs) {
    if (this.registrationAcked) return Promise.resolve(true)
    return new Promise((resolve) => {
      const wrapped = () => {
        clearTimeout(timer)
        resolve(this.registrationAcked)
      }
      const timer = setTimeout(() => {
        this.regAckWaiters = this.regAckWaiters.filter((w) => w !== wrapped)
        resolve(false)
      }, timeoutMs)
      timer.unref()
      this.regAckWaiters.push(wrapped)
    })
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
      this.#clearPairingExpiry()
      this.#setState('open')
      log.info(t('app.connected'))
      return
    }

    if (connection === 'connecting') {
      this.#setState('connecting')
      return
    }

    if (connection !== 'close') return
    this.#clearPairingExpiry()

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
   * @returns {Promise<string>} Texto digitado (normalizado depois).
   */
  async #promptPhoneNumber() {
    if (!process.stdin.isTTY) {
      throw new Error(
        'defina connection.phoneNumber no viewer.config.json para parear sem terminal interativo'
      )
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    try {
      return await new Promise((resolve) => {
        rl.question(`\n${t('app.pairingPrompt')} `, resolve)
      })
    } finally {
      rl.close()
    }
  }

  /**
   * Confirma o número resolvido antes de criar o socket. Sem terminal
   * interativo, segue com aviso (o número fica visível no painel).
   * @returns {Promise<boolean>}
   */
  async #confirmPhoneNumber() {
    if (!process.stdin.isTTY) {
      log.warn('terminal não interativo — seguindo com o número informado')
      return true
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    try {
      const answer = await new Promise((resolve) => {
        rl.question(`${t('app.pairingConfirm')} ${this.pairingPhonePretty}? [s/N] `, resolve)
      })
      return /^s(sim)?$/i.test(answer.trim())
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
    this.#clearPairingExpiry()
    try {
      this.sock?.end(new Error('viewer-shutdown'))
    } catch {
      /* socket já encerrado */
    }
  }
}
