/**
 * @file src/utils/errors.js
 * @module utils/errors
 *
 * Classificação de erros do Viewer.
 * Todo erro recebe uma categoria estável para logs, estatísticas e decisões
 * de recuperação (retry/ignorar), sem expor dados sensíveis.
 */

/** Categorias de erro conhecidas. */
export const ErrorCategory = Object.freeze({
  /** Mídia expirada no servidor (View Once vencida/apagada). */
  EXPIRED: 'expired',
  /** Conteúdo ausente/corrompido. */
  CORRUPTED: 'corrupted',
  /** Falha de rede temporária. */
  NETWORK: 'network',
  /** Falha no envio ao WhatsApp. */
  SEND: 'send',
  /** Operação demorou além do limite. */
  TIMEOUT: 'timeout',
  /** Mensagem não é View Once ou não possui mídia. */
  NOT_ELIGIBLE: 'not-eligible',
  /** Qualquer outra falha. */
  UNKNOWN: 'unknown',
})

/**
 * Erro estruturado do Viewer.
 * @augments Error
 */
export class ViewerError extends Error {
  /**
   * @param {string} category Uma das {@link ErrorCategory}.
   * @param {string} message Mensagem curta (sem dados sensíveis).
   * @param {object} [meta] Metadados seguros (ids, etapas).
   */
  constructor(category, message, meta = {}) {
    super(message)
    this.name = 'ViewerError'
    this.category = category
    this.meta = meta
  }
}

/**
 * Classifica um erro arbitrário (Boom/axios/nativo) em uma categoria.
 * A biblioteca usa erros Boom com `statusCode`; erros de rede do Node
 * carregam `code` (ECONNRESET, ETIMEDOUT...).
 *
 * @param {unknown} error Erro capturado.
 * @returns {string} Categoria estável.
 */
export function classifyError(error) {
  const status = error?.statusCode ?? error?.status ?? error?.response?.status
  if (status === 404 || status === 410) return ErrorCategory.EXPIRED
  if (status === 400) return ErrorCategory.CORRUPTED
  if (status === 408 || status === 499) return ErrorCategory.TIMEOUT

  const code = error?.code
  if (
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'EPIPE'
  ) {
    return ErrorCategory.NETWORK
  }

  if (error instanceof ViewerError) return error.category
  return ErrorCategory.UNKNOWN
}

/**
 * Mensagem curta e segura para log (nunca inclui corpo de resposta).
 * @param {unknown} error Erro capturado.
 * @returns {string} Resumo do erro.
 */
export function describeError(error) {
  if (!error) return 'erro desconhecido'
  const category = classifyError(error)
  const detail = error?.message ? ` (${String(error.message).slice(0, 120)})` : ''
  return `${category}${detail}`
}
