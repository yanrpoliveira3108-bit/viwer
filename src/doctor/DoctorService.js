/**
 * @file src/doctor/DoctorService.js
 * @module doctor
 *
 * Sistema oficial de diagnóstico (`./doctor.sh`).
 *
 * Verifica o ambiente antes da execução do Viewer e produz um relatório
 * com aprovações, avisos, erros e sugestões. Problemas simples são
 * corrigidos automaticamente (diretórios ausentes, configuração incompleta).
 *
 * Privacidade: o relatório nunca exibe IP, localização ou identificadores
 * do aparelho.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ROOT_DIR, APP_VERSION, NODE_VERSION, RELEASE_CHANNELS } from '../constants.js'
import { getBaileysVersion, getBaileys } from '../lib/baileys.js'
import { compareSemver } from '../utils/semver.js'
import { diskSpace } from '../utils/fs.js'
import { defaults, CONFIG_FILE_NAME } from '../config/defaults.js'
import { mergeConfig } from '../config/Config.js'
import { formatBytes } from '../utils/text.js'

/** Resultado individual de uma verificação. */
class CheckResult {
  /**
   * @param {'pass'|'warn'|'fail'} status Estado.
   * @param {string} name Nome da verificação.
   * @param {string} message Detalhe curto.
   * @param {string} [suggestion] Sugestão de correção.
   * @param {boolean} [autoFixed] Corrigido automaticamente.
   */
  constructor(status, name, message, suggestion = '', autoFixed = false) {
    this.status = status
    this.name = name
    this.message = message
    this.suggestion = suggestion
    this.autoFixed = autoFixed
  }
}

export class DoctorService {
  constructor() {
    /** @type {CheckResult[]} */
    this.results = []
  }

  /**
   * Executa todas as verificações e imprime o relatório.
   * @returns {Promise<number>} Código de saída (0 = saudável, 1 = com erros).
   */
  async run() {
    this.#header()

    await this.#checkNode()
    await this.#checkNpm()
    await this.#checkGit()
    await this.#checkBaileys()
    await this.#checkFiles()
    await this.#checkDirectories()
    await this.#checkConfig()
    await this.#checkDatabase()
    await this.#checkSession()
    await this.#checkWaVersion()
    await this.#checkDisk()
    await this.#checkResources()
    await this.#checkTermux()
    await this.#checkUpdates()

    this.#report()
    return this.results.some((r) => r.status === 'fail') ? 1 : 0
  }

  /** @param {CheckResult} result */
  #add(result) {
    this.results.push(result)
  }

  #header() {
    const line = '═'.repeat(38)
    process.stdout.write(`\n${line}\n        VIEWER DOCTOR v${APP_VERSION}\n${line}\n\n`)
  }

  /** Versão do Node.js (mínimo: 20). */
  async #checkNode() {
    const cmp = compareSemver(NODE_VERSION, '20.0.0')
    if (cmp >= 0) {
      this.#add(new CheckResult('pass', 'Node.js', `v${NODE_VERSION}`))
    } else {
      this.#add(
        new CheckResult(
          'fail',
          'Node.js',
          `v${NODE_VERSION} (mínimo: v20 LTS)`,
          'Instale o Node.js LTS 20+: https://nodejs.org'
        )
      )
    }
  }

  /** npm disponível. */
  async #checkNpm() {
    try {
      const { execFileSync } = await import('node:child_process')
      const version = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim()
      this.#add(new CheckResult('pass', 'npm', `v${version}`))
    } catch {
      this.#add(
        new CheckResult(
          'warn',
          'npm',
          'não encontrado',
          'npm acompanha o Node.js — reinstale o Node.js LTS'
        )
      )
    }
  }

  /** git (necessário para o sistema de atualização). */
  async #checkGit() {
    try {
      const { execFileSync } = await import('node:child_process')
      const version = execFileSync('git', ['--version'], { encoding: 'utf8' }).trim()
      this.#add(new CheckResult('pass', 'git', version))
    } catch {
      this.#add(
        new CheckResult(
          'warn',
          'git',
          'não encontrado',
          'Sem git o ./update.sh não funciona. No Termux: pkg install git'
        )
      )
    }
  }

  /** Biblioteca Baileys oficial do projeto. */
  async #checkBaileys() {
    try {
      getBaileys()
      this.#add(new CheckResult('pass', 'Baileys', `boruto_vk7-baileys v${getBaileysVersion()}`))
    } catch (error) {
      this.#add(
        new CheckResult(
          'fail',
          'Baileys',
          'não carregável',
          `Execute: npm install  (${error.message.slice(0, 60)})`
        )
      )
    }
  }

  /** Integridade dos arquivos essenciais. */
  async #checkFiles() {
    const critical = ['index.js', 'package.json', 'src/bootstrap.js', 'update.sh', 'doctor.sh']
    const missing = critical.filter((file) => !fs.existsSync(path.join(ROOT_DIR, file)))
    if (missing.length === 0) {
      this.#add(
        new CheckResult('pass', 'Arquivos', `${critical.length} arquivos essenciais presentes`)
      )
    } else {
      this.#add(
        new CheckResult(
          'fail',
          'Arquivos',
          `ausentes: ${missing.join(', ')}`,
          'Reinstale o Viewer ou restaure via git'
        )
      )
    }
  }

  /** Diretórios do usuário (correção automática). */
  async #checkDirectories() {
    const dirs = ['session', 'data', 'logs', 'backups', 'tmp', 'plugins']
    const created = []
    for (const dir of dirs) {
      const target = path.join(ROOT_DIR, dir)
      if (!fs.existsSync(target)) {
        fs.mkdirSync(target, { recursive: true })
        created.push(dir)
      }
    }
    if (created.length) {
      this.#add(new CheckResult('warn', 'Diretórios', `criados: ${created.join(', ')}`, '', true))
    } else {
      this.#add(new CheckResult('pass', 'Diretórios', 'todos presentes'))
    }

    // Permissão de escrita na raiz.
    const probe = path.join(ROOT_DIR, '.doctor-probe')
    try {
      fs.writeFileSync(probe, 'ok')
      fs.unlinkSync(probe)
      this.#add(new CheckResult('pass', 'Permissões', 'escrita na pasta do projeto'))
    } catch {
      this.#add(
        new CheckResult(
          'fail',
          'Permissões',
          'sem permissão de escrita',
          'Verifique as permissões da pasta (No Termux: termux-setup-storage)'
        )
      )
    }
  }

  /** Consistência da configuração (correção automática de ausências). */
  async #checkConfig() {
    const file = path.join(ROOT_DIR, CONFIG_FILE_NAME)
    if (!fs.existsSync(file)) {
      this.#add(
        new CheckResult(
          'warn',
          'Configuração',
          'arquivo ausente (será criado no próximo início)',
          'O Viewer cria automaticamente a partir do modelo'
        )
      )
      return
    }
    try {
      const user = JSON.parse(fs.readFileSync(file, 'utf8'))
      const issues = []
      mergeConfig(defaults, user, (keyPath) => issues.push(keyPath))
      if (issues.length) {
        this.#add(
          new CheckResult(
            'warn',
            'Configuração',
            `${issues.length} chave(s) ausente(s)/inválida(s) — padrões serão usados`,
            'Revise viewer.config.json'
          )
        )
      } else {
        this.#add(new CheckResult('pass', 'Configuração', 'consistente'))
      }
    } catch {
      this.#add(
        new CheckResult(
          'fail',
          'Configuração',
          'JSON inválido',
          'Corrija o viewer.config.json (ou remova-o para recriar do modelo)'
        )
      )
    }
  }

  /** Consistência do banco de dados. */
  async #checkDatabase() {
    const file = path.join(ROOT_DIR, 'data', 'viewer.db.json')
    if (!fs.existsSync(file)) {
      this.#add(
        new CheckResult('pass', 'Banco de dados', 'ainda não criado (normal no primeiro uso)')
      )
      return
    }
    try {
      JSON.parse(fs.readFileSync(file, 'utf8'))
      this.#add(new CheckResult('pass', 'Banco de dados', 'íntegro'))
    } catch {
      this.#add(
        new CheckResult(
          'warn',
          'Banco de dados',
          'corrompido — será isolado no próximo início',
          'O Viewer preserva a cópia e inicia com banco vazio'
        )
      )
    }
  }

  /** Integridade da sessão (sem exibir nada sensível). */
  async #checkSession() {
    const creds = path.join(ROOT_DIR, 'session', 'creds.json')
    if (!fs.existsSync(creds)) {
      this.#add(
        new CheckResult(
          'warn',
          'Sessão',
          'não pareado ainda',
          'Execute o Viewer e siga o Pairing Code'
        )
      )
      return
    }
    try {
      JSON.parse(fs.readFileSync(creds, 'utf8'))
      this.#add(new CheckResult('pass', 'Sessão', 'credenciais íntegras'))
    } catch {
      this.#add(
        new CheckResult(
          'fail',
          'Sessão',
          'credenciais ilegíveis',
          'Apague a pasta session/ e pareie novamente'
        )
      )
    }
  }

  /**
   * Fontes de versão do WhatsApp (o servidor rejeita versões defasadas).
   * Se nenhuma estiver acessível, o Viewer usa a versão embutida na
   * biblioteca — que pode ser recusada se estiver antiga.
   */
  async #checkWaVersion() {
    const sources = [
      'https://raw.githubusercontent.com/Itsukichann/Baileys/refs/heads/master/lib/Defaults/baileys-version.json',
      'https://api.github.com/repos/WhiskeySockets/Baileys/contents/src/Defaults/baileys-version.json',
    ]
    for (const url of sources) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(6000) })
        if (response.ok) {
          this.#add(new CheckResult('pass', 'Versão WA', 'fontes de versão acessíveis'))
          return
        }
      } catch {
        /* tenta a próxima fonte */
      }
    }
    this.#add(
      new CheckResult(
        'warn',
        'Versão WA',
        'fontes de versão inacessíveis — será usada a versão embutida',
        'Se o WhatsApp recusar a conexão (código 405), verifique a internet/rede'
      )
    )
  }

  /** Espaço em disco. */
  async #checkDisk() {
    const space = await diskSpace(ROOT_DIR)
    if (!space) {
      this.#add(new CheckResult('warn', 'Disco', 'não foi possível medir', ''))
      return
    }
    const free = formatBytes(space.free)
    if (space.free < 20 * 1024 * 1024) {
      this.#add(
        new CheckResult(
          'fail',
          'Disco',
          `apenas ${free} livres`,
          'Libere espaço: mídias precisam de área temporária'
        )
      )
    } else if (space.free < 100 * 1024 * 1024) {
      this.#add(
        new CheckResult(
          'warn',
          'Disco',
          `pouco espaço: ${free} livres`,
          'Libere espaço para downloads confortáveis'
        )
      )
    } else {
      this.#add(new CheckResult('pass', 'Disco', `${free} livres`))
    }
  }

  /** CPU e memória (informativo). */
  async #checkResources() {
    const freeMem = os.freemem()
    const load = os.loadavg()[0].toFixed(2)
    if (freeMem < 80 * 1024 * 1024) {
      this.#add(
        new CheckResult(
          'warn',
          'Memória',
          `apenas ${formatBytes(freeMem)} livres`,
          'Feche aplicativos para evitar quedas'
        )
      )
    } else {
      this.#add(
        new CheckResult('pass', 'Memória', `${formatBytes(freeMem)} livres (carga CPU: ${load})`)
      )
    }
  }

  /** Avisos específicos do Termux. */
  async #checkTermux() {
    const isTermux = process.env.PREFIX?.includes('com.termux') || process.platform === 'android'
    if (!isTermux) return
    const storageOk = fs.existsSync(path.join(os.homedir(), 'storage'))
    if (storageOk) {
      this.#add(new CheckResult('pass', 'Termux', 'acesso a armazenamento configurado'))
    } else {
      this.#add(
        new CheckResult(
          'warn',
          'Termux',
          'permissões de armazenamento ausentes',
          'Execute: termux-setup-storage'
        )
      )
    }
  }

  /** Atualizações pendentes (opcional, tolerante a offline). */
  async #checkUpdates() {
    const channel = RELEASE_CHANNELS.stable
    try {
      const { execFileSync } = await import('node:child_process')
      execFileSync('git', ['fetch', '--depth', '1', 'origin', channel.branch], {
        cwd: ROOT_DIR,
        stdio: 'pipe',
        timeout: 10000,
      })
      const raw = execFileSync('git', ['show', `origin/${channel.branch}:package.json`], {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      })
      const remote = JSON.parse(raw).version
      if (compareSemver(remote, APP_VERSION) > 0) {
        this.#add(
          new CheckResult(
            'warn',
            'Atualização',
            `v${remote} disponível (instalada: v${APP_VERSION})`,
            'Execute: ./update.sh'
          )
        )
      } else {
        this.#add(new CheckResult('pass', 'Atualização', 'sem atualizações pendentes'))
      }
    } catch {
      this.#add(new CheckResult('warn', 'Atualização', 'não verificada (offline ou sem git)', ''))
    }
  }

  /** Imprime o relatório final. */
  #report() {
    const icons = { pass: '✔', warn: '⚠', fail: '✖' }
    const titles = { pass: 'Verificações aprovadas', warn: 'Avisos', fail: 'Erros encontrados' }

    process.stdout.write('\n──────────────────────────────────────\n')
    for (const status of ['pass', 'warn', 'fail']) {
      const group = this.results.filter((r) => r.status === status)
      if (!group.length) continue
      process.stdout.write(`\n${titles[status]} (${group.length})\n`)
      for (const result of group) {
        const fixed = result.autoFixed ? ' (corrigido automaticamente)' : ''
        process.stdout.write(`  ${icons[status]} ${result.name}: ${result.message}${fixed}\n`)
        if (result.suggestion) process.stdout.write(`      ↳ ${result.suggestion}\n`)
      }
    }

    const counts = {
      pass: this.results.filter((r) => r.status === 'pass').length,
      warn: this.results.filter((r) => r.status === 'warn').length,
      fail: this.results.filter((r) => r.status === 'fail').length,
    }
    process.stdout.write(
      `\nResumo: ${counts.pass} aprovadas • ${counts.warn} avisos • ${counts.fail} erros\n\n`
    )
  }
}
