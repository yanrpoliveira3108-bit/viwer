/**
 * @file src/utils/text.js
 * @module utils/text
 *
 * Utilitários de apresentação de terminal: cores ANSI, caixas e barras.
 * Implementação nativa (sem dependências externas).
 *
 * Privacidade: este módulo apenas formata texto; nunca deve receber ou
 * exibir informações de identificação do aparelho ou de localização.
 */

const ESC = '\x1b['
const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined

/**
 * Aplica um código ANSI ao texto (apenas quando cores estão ativas).
 * @param {string} text Texto original.
 * @param {number} code Código SGR.
 * @returns {string} Texto decorado.
 */
function paint(text, code) {
  return useColor ? `${ESC}${code}m${text}${ESC}0m` : text
}

/** Paleta mínima e consistente do Viewer. */
export const color = {
  reset: (t) => paint(t, 0),
  bold: (t) => paint(t, 1),
  dim: (t) => paint(t, 2),
  red: (t) => paint(t, 31),
  green: (t) => paint(t, 32),
  yellow: (t) => paint(t, 33),
  blue: (t) => paint(t, 34),
  magenta: (t) => paint(t, 35),
  cyan: (t) => paint(t, 36),
  white: (t) => paint(t, 37),
  gray: (t) => paint(t, 90),
}

/** Sequências de controle de tela. */
export const ansi = {
  clearScreen: `${ESC}2J${ESC}H`,
  hideCursor: `${ESC}?25l`,
  showCursor: `${ESC}?25h`,
  home: `${ESC}H`,
  clearLine: `${ESC}2K`,
  up: (n = 1) => `${ESC}${n}A`,
  /** Buffer alternativo (estilo htop): painel isolado do scrollback. */
  altScreenOn: `${ESC}?1049h`,
  altScreenOff: `${ESC}?1049l`,
}

/**
 * Largura visível de uma string (remove códigos ANSI para medir).
 * @param {string} text Texto (pode conter ANSI).
 * @returns {number} Largura visível.
 */
export function visibleLength(text) {
  // eslint-disable-next-line no-control-regex
  return String(text).replace(/\u001b\[[0-9;]*m/g, '').length
}

/**
 * Remove códigos ANSI de um texto.
 * @param {string} text Texto decorado.
 * @returns {string} Texto puro.
 */
export function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return String(text).replace(/\u001b\[[0-9;]*m/g, '')
}

/**
 * Trunca texto preservando a largura visível.
 * @param {string} text Texto original.
 * @param {number} max Largura máxima.
 * @param {string} [suffix='…'] Sufixo de truncamento.
 * @returns {string} Texto truncado.
 */
export function truncate(text, max, suffix = '…') {
  const str = String(text)
  if (visibleLength(str) <= max) return str
  let out = ''
  let width = 0
  for (const ch of str) {
    width += 1
    if (width > max - suffix.length) break
    out += ch
  }
  return out + suffix
}

/**
 * Preenche/alinha um texto dentro de uma largura visível.
 * @param {string} text Conteúdo (pode conter ANSI).
 * @param {number} width Largura alvo.
 * @returns {string} Texto com padding à direita.
 */
export function pad(text, width) {
  const missing = width - visibleLength(text)
  return missing > 0 ? text + ' '.repeat(missing) : text
}

/**
 * Centraliza um texto dentro de uma largura visível.
 * @param {string} text Conteúdo.
 * @param {number} width Largura alvo.
 * @returns {string} Texto centralizado.
 */
export function center(text, width) {
  const missing = width - visibleLength(text)
  if (missing <= 0) return text
  const left = Math.floor(missing / 2)
  return ' '.repeat(left) + text + ' '.repeat(missing - left)
}

/**
 * Barra de progresso textual.
 * @param {number} ratio Fração 0..1 (valores fora são saturados).
 * @param {number} [size=20] Largura da barra.
 * @returns {string} Barra renderizada, ex.: `███████░░░░░`.
 */
export function progressBar(ratio, size = 20) {
  const clamped = Math.max(0, Math.min(1, Number(ratio) || 0))
  const filled = Math.round(clamped * size)
  return '█'.repeat(filled) + '░'.repeat(size - filled)
}

/**
 * Constrói uma caixa Unicode com título e linhas de conteúdo.
 * As linhas podem conter ANSI; o dimensionamento usa largura visível.
 *
 * @param {string} title Título da caixa (vazio para ocultar).
 * @param {string[]} lines Linhas de conteúdo.
 * @param {number} [width=64] Largura externa total.
 * @returns {string[]} Linhas da caixa pronta.
 */
export function box(title, lines, width = 64) {
  const inner = width - 2
  const out = []

  if (title) {
    const label = ` ${title} `
    const lineW = Math.max(0, inner - visibleLength(label))
    const left = 2
    out.push('╭─' + color.cyan(label) + '─'.repeat(Math.max(0, lineW - left)) + '╮')
  } else {
    out.push('╭' + '─'.repeat(inner) + '╮')
  }

  for (const raw of lines) {
    out.push('│ ' + pad(truncate(raw, inner - 2), inner - 2) + ' │')
  }
  out.push('╰' + '─'.repeat(inner) + '╯')
  return out
}

/**
 * Linha horizontal dupla para separadores de painel.
 * @param {number} [width=64] Largura.
 * @param {string} [char='═'] Caractere.
 * @returns {string} Linha.
 */
export function divider(width = 64, char = '═') {
  return char.repeat(width)
}

/**
 * Formata bytes para leitura humana.
 * @param {number} bytes Valor em bytes.
 * @returns {string} Ex.: `12.4 MB`.
 */
export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = Number(bytes) || 0
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

/**
 * Sanitiza texto recebido de fontes externas (WhatsApp) antes de exibir.
 * Remove caracteres de controle e limita o tamanho.
 * @param {string} value Texto bruto.
 * @param {number} [max=80] Tamanho máximo.
 * @returns {string} Texto seguro para exibição.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g

export function sanitizeForDisplay(value, max = 80) {
  return truncate(
    String(value ?? '')
      .replace(CONTROL_CHARS, ' ')
      .trim(),
    max
  )
}
