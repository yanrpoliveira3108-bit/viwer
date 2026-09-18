#!/usr/bin/env node
/**
 * @file scripts/update.js
 * Motor do comando oficial de atualização: `./update.sh`.
 *
 * Opções:
 *   --dry-run  mostra o que mudaria sem aplicar;
 *   --force    aplica mesmo que a versão remota seja anterior.
 */

import { UpdateService } from '../src/updater/UpdateService.js'
import { configureLogger } from '../src/logger/index.js'

// O painel do update é a interface: logs do núcleo ficam silenciados aqui.
configureLogger({ level: 'silent', fileEnabled: false, dir: 'logs', maxFileSizeMB: 1, maxFiles: 1 })

const args = process.argv.slice(2)
const service = new UpdateService({
  dryRun: args.includes('--dry-run'),
  force: args.includes('--force'),
})

service.run().then((code) => process.exit(code))
