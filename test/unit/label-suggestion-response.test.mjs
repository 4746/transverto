import assert from 'node:assert/strict'
import {test} from 'node:test'

import {parseLabelSuggestionCompletion} from '../../dist/shared/label-suggestion-response.js'

test('parser accepts one non-empty JSON array of strings', () => {
  assert.deepEqual(parseLabelSuggestionCompletion('["first_key","second.key"]'), [
    'first_key',
    'second.key',
  ])
})

test('parser rejects empty, fenced, object, mixed, and prose responses', () => {
  const invalid = [
    '',
    '[]',
    '~~~json\n["key"]\n~~~',
    '{"key":true}',
    '["key",2]',
    'keys: ["key"]',
  ]

  for (const content of invalid) {
    assert.throws(
      () => parseLabelSuggestionCompletion(content),
      /label suggestion completion/i,
    )
  }
})
