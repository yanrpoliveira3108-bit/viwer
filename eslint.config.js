/**
 * Configuração ESLint (flat config) do Viewer.
 * Padrão único para todo o projeto; código morto e imports/variáveis não
 * utilizados são erros.
 */

import js from '@eslint/js'
import globals from 'globals'

export default [
  {
    ignores: ['node_modules/**', 'session/**', 'data/**', 'logs/**', 'backups/**', 'tmp/**'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
      'no-duplicate-imports': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'object-shorthand': 'error',
    },
  },
]
