/**
 * @file src/i18n/index.js
 * @module i18n
 *
 * Fachada de internacionalização.
 * `t('chave', params)` resolve textos do idioma ativo. Novos idiomas são
 * adicionados criando um arquivo irmão (ex.: `en-US.js`) e apontando a
 * configuração `viewer.language` — nenhuma outra alteração é necessária.
 */

import ptBR from './pt-BR.js'

/** Dicionários disponíveis. */
const dictionaries = { 'pt-BR': ptBR }

/** Idioma ativo (definido por `setLanguage`). */
let current = ptBR

/**
 * Define o idioma ativo. Idiomas desconhecidos caem para pt-BR com aviso.
 * @param {string} language Tag BCP-47 (ex.: `pt-BR`).
 * @returns {boolean} `true` se o idioma foi encontrado.
 */
export function setLanguage(language) {
  const dict = dictionaries[language]
  if (!dict) return false
  current = dict
  return true
}

/**
 * Registra um novo dicionário de idioma (extensão futura).
 * @param {string} language Tag BCP-47.
 * @param {object} dictionary Dicionário com o mesmo formato de pt-BR.
 */
export function registerLanguage(language, dictionary) {
  dictionaries[language] = dictionary
}

/**
 * Resolve um texto por caminho pontuado (ex.: `app.connected`).
 *
 * @param {string} key Caminho da mensagem.
 * @param {Record<string, string|number>} [params] Substituições `{nome}`.
 * @returns {string} Texto resolvido (ou a própria chave, se ausente).
 */
export function t(key, params) {
  let node = current
  for (const part of key.split('.')) {
    node = node?.[part]
  }
  let text = typeof node === 'string' ? node : key
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}
