#!/usr/bin/env node
/**
 * @file scripts/doctor.js
 * Motor do comando oficial de diagnóstico: `./doctor.sh`.
 */

import { DoctorService } from '../src/doctor/DoctorService.js'

new DoctorService()
  .run()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`[VIEWER DOCTOR] falha inesperada: ${error.message}`)
    process.exit(1)
  })
