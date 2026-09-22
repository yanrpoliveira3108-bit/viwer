# Plugins do Viewer

Coloque aqui arquivos `.js` para estender o Viewer sem alterar o núcleo.
O carregamento é automático na inicialização; a falha de um plugin **não**
interrompe o sistema (isolamento total).

## Formato de um plugin

```js
// plugins/meu-plugin.js
export default {
  name: 'meu-plugin',
  version: '1.0.0',

  /**
   * @param {object} ctx Contexto mínimo entregue pelo Viewer:
   *   ctx.bus        — barramento de eventos internos
   *   ctx.logger     — logger nomeado (info/warn/error/debug)
   *   ctx.config     — leitura da configuração ({ get })
   *   ctx.appVersion — versão do Viewer
   */
  register(ctx) {
    ctx.logger.info('plugin ativo')

    ctx.bus.safeOn('viewer:recovery:complete', ({ mediaType, durationMs }) => {
      ctx.logger.info(`recuperação de ${mediaType} em ${durationMs}ms`)
    })
  },
}
```

## Eventos úteis

| Evento                     | Quando ocorre                     |
| -------------------------- | --------------------------------- |
| `viewer:viewonce:detected` | View Once detectada               |
| `viewer:recovery:start`    | Recuperação iniciada              |
| `viewer:recovery:complete` | Recuperação concluída             |
| `viewer:recovery:skipped`  | Recuperação ignorada (com motivo) |
| `viewer:recovery:error`    | Falha em alguma etapa             |
| `connection:state`         | Mudança de estado da conexão      |
| `wa:message`               | Qualquer mensagem processada      |
| `stats:updated`            | Estatísticas atualizadas          |
| `notification:new`         | Notificação interna               |

A lista completa está em `src/constants.js` (`EVENTS`).
