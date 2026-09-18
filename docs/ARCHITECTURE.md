# Arquitetura do Viewer

Documento técnico de referência. O Viewer foi projetado para **crescimento
contínuo**: novas funcionalidades entram como novos módulos/eventos, sem
alterar o núcleo.

## Princípios

- **Responsabilidade única** — cada módulo faz uma coisa.
- **Baixo acoplamento** — módulos se comunicam por eventos (`src/core/EventBus.js`),
  nunca por dependência direta quando evitável.
- **Preferência por recursos nativos** — nenhuma dependência além da
  biblioteca oficial `@lucasmod/boruto-vk7-baileys` (runtime).
- **Nenhuma exceção derruba o sistema** — handlers protegidos, `uncaughtException`
  contido, plugins isolados.
- **JavaScript ESM + JSDoc** — sem etapa de build (ideal para Termux/Android),
  tipado por documentação e pronto para geração automática de docs.

## Mapa de módulos

```
src/
├── lib/baileys.js        ÚNICO ponto de contato com a biblioteca (adaptador
│                         de layout resiliente a mudanças do fork)
├── constants.js          Identidade, versões, canais, contrato de eventos
├── core/EventBus.js      Barramento interno (handlers à prova de exceção)
├── config/               Configuração central (padrões + mesclagem validada)
├── logger/               Níveis DEBUG/INFO/WARN/ERROR + rotação de arquivos
├── i18n/                 Textos centralizados (pt-BR; pronto p/ novos idiomas)
├── database/             Banco JSON atômico, persistência agrupada
├── stats/                Estatísticas (sessão + acumuladas, persistidas)
├── cache/                Índice de View Once (LRU + TTL + anti-duplicidade)
├── connection/           Socket Baileys, Pairing Code, reconexão c/ backoff
├── events/               Ponte eventos WA → pipeline (Métodos 1 e 2)
├── viewer/
│   ├── parser.js         WAMessage → formato interno validado
│   ├── detector.js       Detecção de View Once + classificação de mídia
│   ├── downloader.js     Streaming p/ arquivo temporário (limites/timeout)
│   ├── sender.js         Conteúdo de reenvio SEM viewOnce, com metadados
│   └── pipeline.js       Orquestração da recuperação (dedupe + limpeza)
├── terminal/             Dashboard, tema, logo, etapas de boot
├── plugins/              Carregador automático com isolamento de falhas
├── menu/                 RESERVADO — menu interativo pelo WhatsApp (v futura)
├── notifications/        RESERVADO — notificações internas
├── updater/              Motor de atualização (backup/migrações/rollback)
├── doctor/               Motor de diagnóstico
└── utils/                fs/tempo/texto/recursos/erros/semver
```

## Fluxo de recuperação

```
            ┌───────────────────────────────────────────────┐
 WhatsApp → │ messages.upsert / messages.reaction           │
            └──────────────┬────────────────────────────────┘
                           ▼
                events (parser + gatilhos)
                           │  indexa VO recebidas no cache
                           ▼
                 pipeline.recover()
   1. anti-duplicidade (processadas / em andamento)
   2. localizar original → cache → (fallback) quote embutido
   3. confirmar View Once + detectar mídia (detector)
   4. download streaming → tmp (downloader)
   5. reenvio ao próprio número sem viewOnce (sender)
   6. limpeza do temporário + estatísticas + tempo gasto
```

## Contrato de eventos internos (`EVENTS` em constants.js)

| Evento                              | Payload resumido                        |
| ----------------------------------- | --------------------------------------- |
| `viewer:started` / `viewer:stopped` | —                                       |
| `connection:state`                  | `{ state, statusCode }`                 |
| `connection:socket`                 | `{ sock }` (novo socket criado)         |
| `connection:pairing`                | `{ code }`                              |
| `wa:message`                        | formato interno do parser               |
| `viewer:viewonce:detected`          | `{ origin, chatJid, mediaType }`        |
| `viewer:recovery:start`             | `{ source, chatJid, id, mediaType }`    |
| `viewer:recovery:download:*`        | `{ id, ... }`                           |
| `viewer:recovery:send:*`            | `{ id }`                                |
| `viewer:recovery:complete`          | `{ source, id, mediaType, durationMs }` |
| `viewer:recovery:skipped`           | `{ source, reason }`                    |
| `viewer:recovery:error`             | `{ source, id, category }`              |
| `stats:updated`                     | snapshot de estatísticas                |
| `notification:new`                  | `{ type, message, payload }`            |
| `log:entry`                         | `{ ts, module, level, message, line }`  |

## Decisões de projeto

### Biblioteca única e adaptador resiliente

O empacotamento do fork mudou entre versões (monorepo com código em
`baileys/lib/` no tarball publicado). `src/lib/baileys.js` resolve o ponto de
entrada por candidatos ordenados; quando o fork normalizar o layout, **só o
adaptador muda**. A dependência ausente do fork
(`@boruto_vk7/libsignal-node`) é suprida no `package.json` por alias npm
(`npm:@itsukichan/libsignal-node`), sem scripts de pós-instalação.

### Cache como base dos dois métodos

O WhatsApp não reentrega conteúdo View Once; por isso cada VO recebida é
indexada (chave + mensagem original com chaves de mídia). Limite de entradas
(LRU), TTL e varredura periódica mantêm o consumo mínimo. Respostas/reacções
a mensagens anteriores à conexão atual são ignoradas com aviso (comportamento
esperado e documentado).

### Preservação de metadados no reenvio

`jpegThumbnail`, `seconds`, `waveform`, `ptt`, `gifPlayback`, `caption`,
`fileName` e `mimetype` originais são propagados quando existem — o que
preserva thumbnail/duração mesmo sem ffmpeg/sharp no aparelho e evita
reprocessamento. O campo `viewOnce` nunca é incluído no conteúdo de saída.

### Downloads sem picos de memória

Streaming direto para arquivo temporário com limite de tamanho e timeout
ativo; o arquivo é removido em sucesso **e** em falha.

## Estruturas preparadas (não implementadas na v1)

| Área                 | Ponto de extensão já existente                          |
| -------------------- | ------------------------------------------------------- |
| Menu interativo      | `src/menu/`, eventos, `Config.save()`, `setLevelByName` |
| Plugins              | `src/plugins/` + `plugins/README.md`                    |
| Temas                | `src/terminal/theme.js` (`registerTheme`)               |
| Idiomas              | `src/i18n/` (`registerLanguage`)                        |
| Notificações         | `src/notifications/` (`notify`)                         |
| Estatísticas extras  | `src/stats/` (basta adicionar contadores)               |
| Export/Import config | `Config.save()` + banco encapsulado                     |
| Migrações            | `src/updater/migrations.js` (registro ordenado)         |

## Testes

Testes com `node:test` nativo (`npm test`), cobrindo detector, cache,
configuração, sender, banco, estatísticas e utilitários. Módulos puros
(detector/parser/sender/semver/texto) foram desenhados para teste sem rede.

## Segurança

- `.npmrc` com `ignore-scripts=true` (nenhum pacote executa scripts na instalação);
- entrada do WhatsApp sempre validada/sanitizada antes de uso;
- logs e telas nunca exibem identificadores de aparelho/localização;
- escrita atômica de banco e configuração;
- rollback automático em atualizações; backups com política de retenção.
