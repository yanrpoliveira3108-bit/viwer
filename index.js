#!/usr/bin/env node
/**
 * @file index.js
 *
 * Ponto de entrada do Viewer.
 * Apenas delega ao bootstrap; erros fatais de inicialização são exibidos
 * com orientação de correção (o `doctor.sh` cobre a maioria dos casos).
 */

import { bootstrap } from './src/bootstrap.js'

bootstrap().catch((error) => {
  console.error('\n[VIEWER] Falha fatal na inicialização:')
  console.error(`  ${error?.message ?? error}`)
  console.error('\nSugestão: execute ./doctor.sh para diagnosticar o ambiente.\n')
  process.exit(1)
})
