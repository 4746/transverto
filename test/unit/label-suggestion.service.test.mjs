import assert from 'node:assert/strict'
import {test} from 'node:test'

import {LabelSuggestionService} from '../../dist/shared/label-suggestion.service.js'

const request = {
  count: 5,
  labelValidation: String.raw`^[a-z0-9\._]{2,100}$`,
  text: 'Обрати тип QR-коду',
}

test('service trims, stably deduplicates, and partitions candidates', async () => {
  let calls = 0
  const service = new LabelSuggestionService({
    async suggestLabels() {
      calls += 1
      return [
        ' select_qr_code_type ',
        'Select QR',
        'select_qr_code_type',
        'qr.code',
        'bad-key',
      ]
    },
  })

  assert.deepEqual(await service.suggest(request), {
    invalidSuggestions: ['Select QR', 'bad-key'],
    suggestions: ['select_qr_code_type', 'qr.code'],
  })
  assert.equal(calls, 1)
})

test('service succeeds with zero valid candidates and never refills', async () => {
  let calls = 0
  const service = new LabelSuggestionService({
    async suggestLabels() {
      calls += 1
      return ['Invalid Key']
    },
  })

  assert.deepEqual(await service.suggest(request), {
    invalidSuggestions: ['Invalid Key'],
    suggestions: [],
  })
  assert.equal(calls, 1)
})
