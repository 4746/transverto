import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'

import Ajv2020 from 'ajv/dist/2020.js'

import {CTV_CONFIG_SCHEMA_URL} from '../../dist/shared/constants.js'
import {createConfig} from '../helpers/project-fixture.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))
const schemaFile = path.resolve(directory, '../../schema/ctv.config.schema.json')
const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'))
const validate = new Ajv2020({allErrors: true}).compile(schema)

const assertValid = value => {
  assert.equal(validate(value), true, JSON.stringify(validate.errors, null, 2))
}

const assertInvalid = value => {
  assert.equal(validate(value), false)
  assert.ok(validate.errors?.length)
}

test('schema identity matches generated configuration metadata', () => {
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema')
  assert.equal(schema.$id, CTV_CONFIG_SCHEMA_URL)
  assert.equal(createConfig().$schema, CTV_CONFIG_SCHEMA_URL)
})

test('schema accepts minimal and configured engine profiles', () => {
  assertValid(createConfig())
  assertValid(createConfig({
    engine: 'local',
    engines: {
      local: {
        baseUrl: 'http://localhost:1234/v1',
        model: 'local-model',
        provider: 'openai-compatible',
      },
    },
    fallback: null,
  }))
  assertValid(createConfig({
    engine: 'cloud',
    engines: {
      cloud: {
        apiKeyEnv: 'CTV_GOOGLE_AI_API_KEY',
        model: 'gemini-model',
        provider: 'google-ai',
        reasoning: true,
        temperature: 0.5,
        timeoutMs: 30_000,
      },
    },
  }))
})

test('schema rejects invalid fields and values', () => {
  const invalid = [
    {...createConfig(), unexpected: true},
    createConfig({
      batch: {
        concurrency: 1,
        delayMs: 0,
        maxChars: null,
        maxItems: null,
        mode: 'per-language',
        retry: 2,
        unexpected: true,
      },
    }),
    createConfig({languages: ['EN']}),
    createConfig({basePath: '/absolute/path'}),
    createConfig({labelSuggestionCount: 0}),
    createConfig({cache: {maxEntries: 0, ttlMs: null}}),
    createConfig({engine: 'x', engines: {x: {model: 'm', provider: 'unknown'}}}),
    createConfig({
      engine: 'x',
      engines: {x: {baseUrl: 'ftp://example.com', model: 'm', provider: 'openai-compatible'}},
    }),
    createConfig({
      engine: 'x',
      engines: {x: {apiKeyEnv: 'INVALID-NAME', model: 'm', provider: 'google-ai'}},
    }),
    createConfig({
      engine: 'x',
      engines: {x: {apiKeyEnv: 'KEY', model: 'm', provider: 'google-ai', temperature: 3}},
    }),
    createConfig({engine: 'x', engines: {x: {model: 'm', provider: 'google-ai'}}}),
    createConfig({engine: 'x', engines: {x: {model: 'm', provider: 'openai-compatible'}}}),
  ]

  for (const value of invalid) assertInvalid(value)
})
