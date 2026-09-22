/**
 * @file src/terminal/theme.js
 * @module terminal/theme
 *
 * Tema visual do terminal.
 * O núcleo do Dashboard depende apenas destes papéis semânticos — temas
 * futuros são adicionados aqui sem alterar o renderizador.
 */

import { color } from '../utils/text.js'

/** Tema padrão do Viewer. */
const defaultTheme = {
  frame: color.cyan,
  title: (t) => color.bold(color.cyan(t)),
  brand: (t) => color.bold(color.magenta(t)),
  label: color.gray,
  value: color.white,
  ok: color.green,
  warn: color.yellow,
  error: color.red,
  info: color.blue,
  muted: color.dim,
  bar: { filled: color.green, empty: color.gray },
  log: {
    debug: color.gray,
    info: color.white,
    warn: color.yellow,
    error: color.red,
  },
}

/** Temas registrados. */
const themes = { default: defaultTheme }

/**
 * Obtém um tema pelo nome (desconhecido → `default`).
 * @param {string} [name='default'] Nome do tema.
 * @returns {object} Tema.
 */
export function getTheme(name = 'default') {
  return themes[name] ?? defaultTheme
}

/**
 * Registra um tema novo (extensão futura).
 * @param {string} name Nome.
 * @param {object} theme Definição com os mesmos papéis do padrão.
 */
export function registerTheme(name, theme) {
  themes[name] = { ...defaultTheme, ...theme }
}
