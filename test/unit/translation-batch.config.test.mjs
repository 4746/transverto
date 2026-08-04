import assert from 'node:assert/strict'
import {test} from 'node:test'

import {
  resolveTranslationBatchConfig,
  TRANSLATION_BATCH_DEFAULTS,
} from '../../dist/shared/translation-batch.config.js'

test('batch mode defaults to per-language', () => {
  assert.equal(TRANSLATION_BATCH_DEFAULTS.mode, 'per-language')
  assert.equal(resolveTranslationBatchConfig(undefined).mode, 'per-language')
  assert.equal(resolveTranslationBatchConfig({concurrency: 2}).mode, 'per-language')
})

test('batch mode accepts multi-language', () => {
  assert.equal(resolveTranslationBatchConfig({mode: 'multi-language'}).mode, 'multi-language')
})

test('batch mode rejects unknown values', () => {
  assert.throws(
    () => resolveTranslationBatchConfig({mode: 'provider-native'}),
    /batch\.mode must be "per-language" or "multi-language"/,
  )
})
