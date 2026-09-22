/**
 * @file src/updater/UpdateService.js
 * @module updater
 *
 * Sistema oficial de atualização do Viewer (`./update.sh`).
 *
 * Estratégia (robusta, incremental e reversível):
 *   1. verifica internet;
 *   2. identifica o canal configurado (apenas Stable ativo nesta versão);
 *   3. busca a versão mais recente do canal no repositório oficial (git);
 *   4. compara versões (SemVer);
 *   5. lista arquivos alterados;
 *   6. cria backup completo dos dados do usuário;
 *   7. aplica a atualização apenas sobre arquivos versionados (dados do
 *      usuário são gitignorado e nunca são tocados);
 *   8. instala dependências somente se package.json/lock mudaram;
 *   9. executa migrações pendentes;
 *  10. valida integridade;
 *  11. remove backups antigos conforme política;
 *  Em qualquer falha: rollback automático ao estado anterior.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT_DIR, APP_VERSION, RELEASE_CHANNELS } from '../constants.js'
import { compareSemver } from '../utils/semver.js'
import { divider, color } from '../utils/text.js'
import { createBackup, restoreBackup, pruneBackups } from './backup.js'
import { runMigrations } from './migrations.js'
import { loadConfig } from '../config/Config.js'
import { getBaileys } from '../lib/baileys.js'

const WIDTH = 62

/** Arquivos cuja alteração exige reinstalação de dependências. */
const DEPENDENCY_FILES = new Set(['package.json', 'package-lock.json', '.npmrc'])

/** Arquivos essenciais validados após a atualização. */
const CRITICAL_FILES = ['index.js', 'package.json', 'src/bootstrap.js', 'src/constants.js']

/**
 * Executa git com argumentos, lançando erro legível em falha.
 * @param {string[]} args Argumentos.
 * @param {object} [opts] Opções extras do execFileSync.
 * @returns {string} Saída padrão.
 */
function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT_DIR, encoding: 'utf8', ...opts }).trim()
}

/**
 * Etapa do painel: título de seção.
 * @param {string} text Texto.
 */
function step(text) {
  process.stdout.write(`\n${color.cyan('▸')} ${text}\n`)
}

/**
 * Mensagem de detalhe da etapa.
 * @param {string} text Texto.
 */
function detail(text) {
  process.stdout.write(`   ${color.gray(text)}\n`)
}

export class UpdateService {
  /**
   * @param {object} [options] Opções.
   * @param {boolean} [options.dryRun=false] Simula sem alterar nada.
   * @param {boolean} [options.force=false] Aceita também "downgrade".
   */
  constructor({ dryRun = false, force = false } = {}) {
    this.dryRun = dryRun
    this.force = force
    this.previousCommit = null
    this.backupEntry = null
    this.config = null
    /** `true` apenas depois que arquivos foram efetivamente alterados. */
    this.applied = false
  }

  /** Ponto de entrada do comando `./update.sh`. @returns {Promise<number>} Código de saída. */
  async run() {
    this.#panel()
    try {
      this.config = await loadConfig()

      const channel = await this.#resolveChannel()
      if (!channel) return 0

      step('Verificando versão instalada...')
      detail(`instalada: v${APP_VERSION}`)
      this.previousCommit = this.#requireGitState()

      step('Buscando atualizações...')
      await this.#checkInternet()
      const remote = await this.#fetchRemote(channel.branch)
      detail(`disponível: v${remote.version} (${channel.label})`)

      step('Comparando arquivos...')
      const decision = this.#compareVersions(remote.version)
      if (decision === 'up-to-date') {
        process.stdout.write(`\n${color.green('O Viewer já está atualizado.')}\n`)
        return 0
      }
      const changes = this.#listChanges()
      detail(`${changes.length} arquivo(s) com alteração`)
      for (const file of changes.slice(0, 15)) detail(`  ${file}`)
      if (changes.length > 15) detail(`  ... e mais ${changes.length - 15}`)
      if (this.dryRun) {
        process.stdout.write(`\n${color.yellow('[dry-run] Nenhuma alteração foi aplicada.')}\n`)
        return 0
      }

      step('Criando backup...')
      const backupDir = this.config.resolvePath(this.config.get('update.backupDir'))
      this.backupEntry = createBackup({ backupDir, toVersion: remote.version })
      detail(
        `backup em backups/${path.basename(this.backupEntry.dir)} (${this.backupEntry.items.length} itens)`
      )

      step('Baixando alterações...')
      // Já baixado pelo fetch da comparação acima.

      step('Atualizando arquivos...')
      this.#applyUpdate()
      const depsChanged = changes.some((file) => DEPENDENCY_FILES.has(file))
      if (depsChanged) this.#installDependencies()

      step('Executando migrações...')
      const executed = runMigrations({
        fromVersion: APP_VERSION,
        toVersion: remote.version,
        log: detail,
      })
      detail(executed ? `${executed} migração(ões) executada(s)` : 'nenhuma migração pendente')

      step('Validando instalação...')
      this.#validate(remote.version)

      step('Finalizando...')
      pruneBackups(backupDir, this.config.get('update.keepBackups'))

      process.stdout.write(`\n${color.green('Atualização concluída com sucesso.')}\n`)
      process.stdout.write(
        color.gray('Reinicie o Viewer (npm start) se ele estiver em execução.\n')
      )
      return 0
    } catch (error) {
      return this.#fail(error)
    }
  }

  /** Exibe o cabeçalho do painel. */
  #panel() {
    process.stdout.write('\n' + color.cyan(divider(WIDTH - 24)) + '\n')
    process.stdout.write(color.bold(color.cyan('            VIEWER UPDATE\n')))
    process.stdout.write(color.cyan(divider(WIDTH - 24)) + '\n')
  }

  /**
   * Valida e resolve o canal configurado.
   * @returns {Promise<object|null>} Canal ativo ou `null` (encerra com aviso).
   */
  async #resolveChannel() {
    const name = this.config.get('update.channel')
    const channel = RELEASE_CHANNELS[name]
    if (!channel) {
      process.stdout.write(color.red(`Canal desconhecido: "${name}". Use stable.\n`))
      return null
    }
    if (!channel.active) {
      process.stdout.write(
        color.yellow(`Canal ${channel.label}: em preparação — apenas o canal Stable está ativo.\n`)
      )
      return null
    }
    detail(`canal: ${channel.label} (${channel.branch})`)
    return channel
  }

  /** Verifica o estado git local (exigência do atualizador). @returns {string} Commit atual. */
  #requireGitState() {
    if (!fs.existsSync(path.join(ROOT_DIR, '.git'))) {
      throw new Error(
        'instalação sem repositório git. Reinstale via: git clone <repositório oficial>'
      )
    }
    const commit = git(['rev-parse', 'HEAD'])
    // Garante que existe um remoto oficial configurado.
    try {
      git(['remote', 'get-url', 'origin'])
    } catch {
      throw new Error(
        'remoto "origin" ausente. Configure: git remote add origin <repositório oficial>'
      )
    }
    detail(`commit atual: ${commit.slice(0, 8)}`)
    return commit
  }

  /**
   * Verifica conectividade usando o mesmo caminho da atualização (git).
   * Evita falsos negativos de proxies/ambientes restritos.
   */
  async #checkInternet() {
    try {
      execFileSync('git', ['ls-remote', 'origin', 'HEAD'], {
        cwd: ROOT_DIR,
        stdio: 'pipe',
        timeout: 15000,
      })
    } catch {
      throw new Error('sem conexão com a internet (repositório inacessível)')
    }
  }

  /**
   * Baixa o branch do canal e lê a versão remota.
   * @param {string} branch Branch do canal.
   * @returns {Promise<{version: string, ref: string}>}
   */
  async #fetchRemote(branch) {
    this.branch = branch
    git(['fetch', '--depth', '1', 'origin', branch], { stdio: 'pipe' })
    let raw
    try {
      raw = git(['show', `origin/${branch}:package.json`], { stdio: ['pipe', 'pipe', 'ignore'] })
    } catch {
      throw new Error(`branch "${branch}" não contém package.json (canal ainda não publicado?)`)
    }
    const pkg = JSON.parse(raw)
    if (!pkg.version) throw new Error('package.json remoto sem versão')
    return { version: pkg.version, ref: `origin/${branch}` }
  }

  /**
   * Decide se há atualização aplicável.
   * @param {string} remoteVersion Versão remota.
   * @returns {'apply'|'up-to-date'}
   */
  #compareVersions(remoteVersion) {
    const cmp = compareSemver(remoteVersion, APP_VERSION)
    if (cmp === 0) return 'up-to-date'
    if (cmp < 0 && !this.force) {
      process.stdout.write(
        color.yellow(
          `Versão remota (v${remoteVersion}) é anterior à instalada (v${APP_VERSION}). `
        ) + color.gray('Use --force para aplicar mesmo assim.\n')
      )
      return 'up-to-date'
    }
    return 'apply'
  }

  /**
   * Lista arquivos alterados entre o commit atual e o remoto.
   * @returns {string[]} Caminhos relativos.
   */
  #listChanges() {
    const output = git(['diff', '--name-only', 'HEAD', `origin/${this.branch}`])
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  }

  /** Aplica a atualização sobre arquivos versionados (dados do usuário ficam intactos). */
  #applyUpdate() {
    git(['reset', '--hard', `origin/${this.branch}`])
    this.applied = true
    detail('arquivos atualizados')
  }

  /** Reinstala dependências apenas quando necessário. */
  #installDependencies() {
    step('Instalando dependências alteradas...')
    try {
      execFileSync('npm', ['install', '--no-audit', '--no-fund'], {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      })
    } catch (error) {
      throw new Error(`falha ao instalar dependências: ${error.message}`)
    }
  }

  /**
   * Valida a instalação após atualizar.
   * @param {string} expectedVersion Versão esperada no package.json.
   */
  #validate(expectedVersion) {
    for (const file of CRITICAL_FILES) {
      if (!fs.existsSync(path.join(ROOT_DIR, file))) {
        throw new Error(`arquivo essencial ausente após atualização: ${file}`)
      }
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'))
    if (pkg.version !== expectedVersion) {
      throw new Error(`versão inesperada após atualização (${pkg.version} != ${expectedVersion})`)
    }
    // Biblioteca continua carregável.
    getBaileys()
    detail('arquivos, módulos e biblioteca validados')
  }

  /**
   * Falha controlada: rollback completo e automático.
   * @param {unknown} error Erro capturado.
   * @returns {number} Código de saída 1.
   */
  #fail(error) {
    process.stdout.write(`\n${color.red(`Falha: ${error.message}`)}\n`)
    if (!this.applied) {
      process.stdout.write(color.gray('Nenhuma alteração havia sido aplicada.\n'))
      return 1
    }
    try {
      process.stdout.write(color.yellow('Restaurando estado anterior (rollback automático)...\n'))
      git(['reset', '--hard', this.previousCommit])
      if (this.backupEntry) restoreBackup(this.backupEntry.dir)
      process.stdout.write(color.green('Estado anterior restaurado. Nenhum dado foi perdido.\n'))
    } catch (rollbackError) {
      process.stdout.write(
        color.red(`Rollback falhou: ${rollbackError.message}. `) +
          color.gray(`Backup disponível em: ${this.backupEntry?.dir ?? 'backups/'}\n`)
      )
    }
    return 1
  }
}
