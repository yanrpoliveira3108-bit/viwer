/**
 * @file src/menu/index.js
 * @module menu
 *
 * MENU INTERATIVO — ESTRUTURA RESERVADA (não implementado na v1).
 *
 * A arquitetura já está pronta para o menu:
 * - configuração central (`Config.save()` persiste alterações);
 * - barramento de eventos para receber comandos vindos do WhatsApp;
 * - logger com nível ajustável em tempo de execução (`setLevelByName`);
 * - estatísticas (`Stats.snapshot()`) para exibição;
 * - plugins e canais já parametrizados por configuração.
 *
 * Contrato previsto para a implementação futura:
 *
 *   class MenuManager {
 *     start({ sock, config, stats, bus })  // registra comandos no WA
 *     registerCommand(name, handler)       // extensão por plugins
 *   }
 *
 * Opções previstas (ver prompt do projeto): capturas automáticas por tipo,
 * grupos/privado, logs, canal de atualização, estatísticas, plugins,
 * exportação/importação de configurações etc.
 */

/**
 * Gerenciador de menu (stub).
 * Mantém a superfície pública estável para o futuro sem executar nada.
 */
export class MenuManager {
  /**
   * @param {object} _deps Dependências futuras (sock, config, stats...).
   */
  constructor(_deps = {}) {
    this.enabled = false
  }

  /** Inicialização (no-op na v1). @returns {Promise<void>} */
  async start() {
    /* reservado para implementação futura */
  }

  /** Encerramento (no-op na v1). @returns {Promise<void>} */
  async stop() {
    /* reservado para implementação futura */
  }
}
