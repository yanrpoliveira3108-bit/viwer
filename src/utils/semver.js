/**
 * @file src/utils/semver.js
 * @module utils/semver
 *
 * Comparação de Versionamento Semântico (SemVer) sem dependências.
 * Suporta prefixo `v` e descarta sufixos de pré-lançamento na comparação
 * de ordenação (mantém apenas major.minor.patch).
 */

/**
 * Normaliza uma versão para `[major, minor, patch]`.
 * @param {string} version Versão (ex.: `v1.2.3`, `1.2.3-beta`).
 * @returns {number[]|null} Tripla numérica ou `null` se inválida.
 */
export function parseSemver(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version ?? '').trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * @param {string} version Versão candidata.
 * @returns {boolean} `true` se é um SemVer válido.
 */
export function isSemver(version) {
  return parseSemver(version) !== null
}

/**
 * Compara duas versões SemVer.
 * @param {string} a Primeira versão.
 * @param {string} b Segunda versão.
 * @returns {-1|0|1} `-1` se a<b, `0` se iguais, `1` se a>b.
 */
export function compareSemver(a, b) {
  const pa = parseSemver(a) ?? [0, 0, 0]
  const pb = parseSemver(b) ?? [0, 0, 0]
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] < pb[i]) return -1
    if (pa[i] > pb[i]) return 1
  }
  return 0
}
