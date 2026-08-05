import assert from 'node:assert/strict'
import {test} from 'node:test'

import {CONFIG_DEFAULT} from '../../dist/shared/config.js'
import {resolveLabelSuggestionConfig} from '../../dist/shared/label-suggestion.config.js'

test('label suggestion defaults are five and hidden invalid candidates', () => {
  assert.equal(CONFIG_DEFAULT.labelSuggestionCount, 5)
  assert.equal(CONFIG_DEFAULT.labelSuggestionShowInvalid, false)
  assert.deepEqual(resolveLabelSuggestionConfig(CONFIG_DEFAULT), {
    count: 5,
    labelValidation: CONFIG_DEFAULT.labelValidation,
    showInvalid: false,
  })
})

test('count override wins over project configuration', () => {
  assert.equal(resolveLabelSuggestionConfig({
    ...CONFIG_DEFAULT,
    labelSuggestionCount: 7,
    labelSuggestionShowInvalid: true,
  }, 12).count, 12)
})

test('label suggestion configuration rejects invalid values', () => {
  for (const value of [0, -1, 1.5, Number.NaN, '5']) {
    assert.throws(() => resolveLabelSuggestionConfig({
      ...CONFIG_DEFAULT,
      labelSuggestionCount: value,
    }), /labelSuggestionCount must be a positive integer/)
  }

  assert.throws(() => resolveLabelSuggestionConfig({
    ...CONFIG_DEFAULT,
    labelSuggestionShowInvalid: 'yes',
  }), /labelSuggestionShowInvalid must be a boolean/)
  assert.throws(() => resolveLabelSuggestionConfig({
    ...CONFIG_DEFAULT,
    labelValidation: '[',
  }), /labelValidation must be a valid regular expression/)
})
