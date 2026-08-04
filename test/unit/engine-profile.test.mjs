import assert from 'node:assert/strict'
import {test} from 'node:test'

import {
  resolveEngineProfile,
  validateEngineConfiguration,
} from '../../dist/shared/engine-profile.js'

test('engine profile preserves request options through validation and resolution', () => {
  const engines = validateEngineConfiguration('fixture', {
    fixture: {
      baseUrl: 'http://fixture.test/v1',
      model: 'fixture-model',
      provider: 'openai-compatible',
      reasoning: false,
      systemPrompt: '  Keep this spacing.  ',
      temperature: 0.25,
    },
  })

  assert.deepEqual(engines.fixture, {
    baseUrl: 'http://fixture.test/v1',
    model: 'fixture-model',
    provider: 'openai-compatible',
    reasoning: false,
    systemPrompt: '  Keep this spacing.  ',
    temperature: 0.25,
  })

  const resolved = resolveEngineProfile(
    {engine: 'fixture', engines},
    undefined,
    {},
    {requireCredentials: false},
  )
  assert.equal(resolved.systemPrompt, '  Keep this spacing.  ')
  assert.equal(resolved.temperature, 0.25)
  assert.equal(resolved.reasoning, false)
})

test('engine profile leaves request options absent for old configurations', () => {
  const resolved = resolveEngineProfile({
    engine: 'fixture',
    engines: {
      fixture: {
        baseUrl: 'http://fixture.test/v1',
        model: 'fixture-model',
        provider: 'openai-compatible',
      },
    },
  }, undefined, {}, {requireCredentials: false})

  assert.equal(Object.hasOwn(resolved, 'systemPrompt'), false)
  assert.equal(Object.hasOwn(resolved, 'temperature'), false)
  assert.equal(Object.hasOwn(resolved, 'reasoning'), false)
})

test('engine profile rejects invalid request options', () => {
  const invalid = [
    ['systemPrompt', 42, /systemPrompt must be a string/],
    ['temperature', Number.NaN, /temperature must be a finite number from 0 through 2/],
    ['temperature', -0.01, /temperature must be a finite number from 0 through 2/],
    ['temperature', 2.01, /temperature must be a finite number from 0 through 2/],
    ['reasoning', 'false', /reasoning must be a boolean/],
  ]

  for (const [field, value, message] of invalid) {
    assert.throws(() => validateEngineConfiguration('fixture', {
      fixture: {
        baseUrl: 'http://fixture.test/v1',
        [field]: value,
        model: 'fixture-model',
        provider: 'openai-compatible',
      },
    }), message)
  }
})
