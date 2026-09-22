/**
 * @file src/config/defaults.js
 * @module config/defaults
 *
 * Valores padrão de TODA a configuração do Viewer.
 * Este é o único lugar onde padrões existem; módulos nunca embutem opções.
 *
 * Convenções:
 * - Chaves novas devem ser adicionadas aqui (migração automática).
 * - Diretórios são relativos à raiz do projeto.
 * - Tamanhos em MB, tempos em ms (sufixo no nome indica a unidade).
 */

export const CONFIG_FILE_NAME = 'viewer.config.json'
export const CONFIG_SAMPLE_NAME = 'viewer.config.sample.json'

export const defaults = {
  viewer: {
    /** Idioma da interface (`pt-BR`). Preparado para i18n futura. */
    language: 'pt-BR',
    /** Tema do terminal (`default`). Preparado para temas futuros. */
    theme: 'default',
  },

  connection: {
    /** Número para o Pairing Code (somente dígitos, com DDI+DDD). Vazio = perguntar. */
    phoneNumber: '',
    /** Código de pareamento personalizado (8 caracteres). Vazio = aleatório. */
    customPairingCode: '',
    /** Diretório da sessão/credenciais (preservado em atualizações). */
    sessionDir: 'session',
    /** Identidade do navegador enviada ao WhatsApp. */
    browser: ['Ubuntu', 'Viewer', '1.0.0'],
    reconnect: {
      enabled: true,
      /** 0 = tentativas ilimitadas. */
      maxAttempts: 0,
      baseDelayMs: 3000,
      maxDelayMs: 60000,
    },
    /** Sincronizar todo o histórico ao conectar (consome mais rede/memória). */
    syncFullHistory: false,
    markOnlineOnConnect: true,
  },

  features: {
    /** Método 1 — recuperar ao responder uma View Once. */
    recoverOnReply: true,
    /** Método 2 — recuperar ao reagir a uma View Once. */
    recoverOnReaction: true,
    /**
     * Canais (@newsletter): o protocolo do WhatsApp não entrega "quem
     * reagiu" nem permite responder em canais, então os gatilhos de
     * resposta/reação não existem lá. Para cumprir "salvar View Once de
     * canal", o Viewer recupera automaticamente toda View Once que chegar
     * de um canal enquanto estiver conectado (padrão: ligado).
     */
    recoverChannelsAuto: true,
    /**
     * Preparado para o futuro menu interativo (captura automática ao
     * receber, por tipo, grupos/privado). Não implementado nesta versão.
     */
    autoRecover: { enabled: false, types: [], groups: true, private: true },
  },

  media: {
    /** Diretório de arquivos temporários de download. */
    tempDir: 'tmp',
    /** Limite de tamanho aceito por mídia. */
    maxFileSizeMB: 200,
    downloadTimeoutMs: 180000,
    sendTimeoutMs: 180000,
  },

  cache: {
    /** Máximo de mensagens View Once indexadas em memória. */
    maxEntries: 500,
    /** Validade dos registros (minutos). */
    ttlMinutes: 1440,
    /** Intervalo da limpeza automática (segundos). */
    sweepIntervalSeconds: 60,
  },

  logs: {
    /** `debug|info|warn|error|silent` — DEBUG desativado por padrão. */
    level: 'info',
    fileEnabled: true,
    dir: 'logs',
    maxFileSizeMB: 5,
    maxFiles: 5,
  },

  dashboard: {
    enabled: true,
    /** Intervalo de atualização do painel (ms). */
    refreshMs: 2000,
    /** Quantidade de linhas de log exibidas no painel. */
    logLines: 8,
  },

  database: {
    file: 'data/viewer.db.json',
    /** Intervalo de persistência (ms) — escrita agrupada, poupa disco. */
    saveIntervalMs: 30000,
  },

  stats: {
    /** Persistir estatísticas entre reinícios. */
    persist: true,
  },

  update: {
    /** Canal ativo: `stable` (beta/dev preparados, inativos nesta versão). */
    channel: 'stable',
    /** Repositório oficial do projeto (fonte das atualizações). */
    repoOwner: 'yanrpoliveira3108-bit',
    repoName: 'viwer',
    backupDir: 'backups',
    /** Quantidade de backups mantidos (mais antigos são removidos). */
    keepBackups: 5,
  },

  plugins: {
    enabled: true,
    dir: 'plugins',
  },

  /** Preparado — menu interativo pelo WhatsApp (não implementado em v1). */
  menu: { enabled: false },

  /** Preparado — notificações internas. */
  notifications: { enabled: true },
}

/**
 * Caminhos que NUNCA podem ser sobrescritos por uma atualização
 * (dados do usuário). Usado pelo sistema de update.
 */
export const PROTECTED_PATHS = Object.freeze([
  'session',
  'data',
  'logs',
  'backups',
  'tmp',
  'viewer.config.json',
  'plugins',
  'node_modules',
  '.git',
])
