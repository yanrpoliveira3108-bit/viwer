<p align="center">

```
██╗   ██╗██╗███████╗██╗    ██╗███████╗██████╗
██║   ██║██║██╔════╝██║    ██║██╔════╝██╔══██╗
██║   ██║██║█████╗  ██║ █╗ ██║█████╗  ██████╔╝
╚██╗ ██╔╝██║██╔══╝  ██║███╗██║██╔══╝  ██╔══██╗
 ╚████╔╝ ██║███████╗╚███╔███╔╝███████╗██║  ██║
  ╚═══╝  ╚═╝╚══════╝ ╚══╝╚══╝ ╚══════╝╚═╝  ╚═╝
```

</p>

<h1 align="center">Viewer</h1>

<p align="center">
  Bot dedicado à <strong>recuperação de mídias em Visualização Única (View Once)</strong> do WhatsApp.<br/>
  Construído exclusivamente sobre <a href="https://github.com/Otakump4/boruto_vk7-baileys">boruto_vk7-baileys</a>.
</p>

---

## O que o Viewer faz

Quando o número conectado ao Viewer **responde** ou **reage** a uma mensagem
View Once, a mídia original é localizada, baixada e reenviada para o chat
privado do próprio número — **sem a propriedade View Once**, preservando
resolução, qualidade, legenda, duração, thumbnail, nome do arquivo, mimetype
e metadados disponíveis.

Dois métodos oficiais (nenhum outro):

| Método    | Gatilho                                                   |
| --------- | --------------------------------------------------------- |
| Responder | O número conectado responde uma mensagem View Once        |
| Reagir    | O número conectado reage (qualquer emoji) a uma View Once |

O comportamento é idêntico em conversas privadas e grupos.

### Mídias suportadas

Imagens, vídeos, áudios, documentos, stickers e GIFs — qualquer mídia
suportada pela biblioteca, detectada automaticamente (tipos futuros são
reenviados como documento, sem perda do arquivo).

## Requisitos

- **Node.js LTS 20+** (recomendado: 22 LTS)
- **npm**
- **git** (necessário para o sistema oficial de atualização)
- Android/Termux, Linux ou similar
- WhatsApp Multi Device

## Instalação

```bash
# 1. Clonar o repositório oficial
git clone https://github.com/yanrpoliveira3108-bit/viwer.git viewer
cd viewer

# 2. Instalar dependências
npm install

# 3. (Opcional) diagnosticar o ambiente
./doctor.sh

# 4. Executar
npm start
```

### Termux

```bash
pkg update && pkg install nodejs git -y
git clone https://github.com/yanrpoliveira3108-bit/viwer.git viewer
cd viewer
npm install
npm start
```

> O arquivo `.npmrc` do projeto já desativa scripts de instalação de
> terceiros (segurança de cadeia de suprimentos) — nada extra a configurar.

## Primeiro uso — Pairing Code

1. Execute `npm start`.
2. Informe seu número (DDI+DDD, somente dígitos) quando solicitado — ou
   preencha `connection.phoneNumber` no `viewer.config.json` antes.
3. O Viewer exibe o **código de pareamento** (ex.: `ABCD-1234`).
4. No celular: **WhatsApp → Configurações → Aparelhos conectados →
   Conectar com número de telefone** e digite o código.
5. Pronto: o Dashboard assume a tela.

A sessão fica em `session/` e **nunca** é perdida em atualizações.

## Dashboard

Terminal profissional com atualização automática: logo, versão, canal,
Node.js/Baileys/WhatsApp, plataforma, status da conexão, tempo de atividade,
CPU e RAM (com barras), mensagens processadas, mídias recuperadas, erros,
hora de início e logs recentes. Em saída não interativa (pipes), o painel é
desativado automaticamente e os logs fluem normalmente.

## Comandos

| Comando                 | Descrição                                                                   |
| ----------------------- | --------------------------------------------------------------------------- |
| `npm start`             | Executa o Viewer                                                            |
| `./update.sh`           | Atualização oficial (segura, incremental, com backup e rollback automático) |
| `./update.sh --dry-run` | Simula a atualização sem aplicar                                            |
| `./doctor.sh`           | Diagnóstico completo do ambiente (com correções automáticas simples)        |
| `npm test`              | Testes automatizados (node:test, sem dependências)                          |
| `npm run lint`          | ESLint                                                                      |
| `npm run format`        | Prettier                                                                    |

## Configuração

Toda a configuração fica em **`viewer.config.json`** (criado automaticamente
a partir de `viewer.config.sample.json`). Nenhuma configuração existe dentro
do código. Chaves ausentes ou inválidas recebem o valor padrão com aviso no
log — o Viewer nunca deixa de iniciar por configuração.

Destaques:

```jsonc
{
  "connection": {
    "phoneNumber": "", // número do pareamento (só dígitos)
    "customPairingCode": "", // código personalizado opcional (8 caracteres)
  },
  "features": {
    "recoverOnReply": true, // Método 1 — responder
    "recoverOnReaction": true, // Método 2 — reagir
  },
  "cache": { "maxEntries": 500, "ttlMinutes": 1440 },
  "logs": { "level": "info", "maxFileSizeMB": 5, "maxFiles": 5 },
  "update": { "channel": "stable" },
}
```

## Como funciona por dentro (resumo)

1. Toda View Once **recebida** é indexada num cache leve (chave da mensagem +
   chaves de mídia), com TTL e limite de memória.
2. Ao **responder** ou **reagir**, o Viewer localiza a mensagem original no
   cache (ou no conteúdo citado embutido, como reserva), confirma que é View
   Once e detecta o tipo da mídia.
3. A mídia é baixada **em streaming** para arquivo temporário (baixa memória),
   reenviada ao próprio número sem o atributo View Once e o arquivo é apagado.
4. Duplicidades são bloqueadas (mensagens já recuperadas ou em recuperação).
5. Mensagens expiradas, apagadas, corrompidas, sem mídia ou que não sejam
   View Once são ignoradas automaticamente — nenhuma exceção derruba o Viewer.

Arquitetura modular orientada a eventos, detalhes em
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Sistema de atualização

`./update.sh` verifica a internet, identifica o canal configurado, compara a
versão instalada com a mais recente, **cria backup** de sessão, banco,
configurações e dados, aplica apenas os arquivos alterados, instala
dependências somente quando necessário, executa migrações, valida a
instalação e remove backups antigos. Qualquer falha dispara **rollback
automático** ao estado anterior. Canais Beta/Development estão preparados na
arquitetura; apenas o canal **Stable** está ativo nesta versão.

## Privacidade

O Viewer **nunca** exibe ou registra: IP, localização, GPS, coordenadas,
operadora, hostname, MAC, IMEI, número de série ou qualquer identificador do
aparelho. Os logs contêm apenas eventos operacionais.

## Solução de problemas

- **`./doctor.sh`** cobre a maioria dos casos (Node, npm, git, biblioteca,
  arquivos, permissões, disco, memória, configuração, banco, sessão,
  atualizações).
- Não pareou? Confira o número (DDI+DDD) e repita o processo.
- Sessão corrompida: apague `session/` e pareie novamente.

## Licença

[MIT](LICENSE)
