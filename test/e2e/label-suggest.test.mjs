import assert from 'node:assert/strict'
import {test} from 'node:test'

import {startOpenAiServer} from '../helpers/http-server.mjs'
import {
  createConfig,
  createProject,
  parseJsonOutput,
  runCli,
} from '../helpers/project-fixture.mjs'

const completion = suggestions => ({
  body: {choices: [{message: {content: JSON.stringify(suggestions)}}]},
  status: 200,
})

const engineProfile = (baseUrl, overrides = {}) => ({
  baseUrl,
  model: 'fixture-model',
  provider: 'openai-compatible',
  ...overrides,
})

test('label:suggest uses configured defaults and hides invalid candidates', async testContext => {
  const server = await startOpenAiServer(testContext, async () => completion([
    'select_qr_code_type',
    'Select QR code type',
    'select_qr_code_type',
    'select_qrcode_type',
  ]))
  const project = await createProject(testContext, {
    config: createConfig({
      engine: 'fixture',
      engines: {
        fixture: engineProfile(server.baseUrl, {
          labelSuggestionPrompt: 'Fixture label prompt',
        }),
      },
    }),
  })

  const result = await runCli(project, [
    'label:suggest',
    'Обрати тип QR-коду',
    '--json',
  ])

  assert.equal(result.exitCode, 0, result.stderr)
  assert.equal(server.requests.length, 1)
  assert.equal(server.requests[0].body.messages[0].content, 'Fixture label prompt')
  assert.match(server.requests[0].body.messages[1].content, /5 unique/)
  assert.deepEqual(parseJsonOutput(result), {
    suggestions: ['select_qr_code_type', 'select_qrcode_type'],
  })
})

test('label:suggest exposes invalid candidates after valid text output when configured', async testContext => {
  const server = await startOpenAiServer(testContext, async () => completion([
    'select_qr_code_type',
    'Select QR code type',
  ]))
  const project = await createProject(testContext, {
    config: createConfig({
      engine: 'fixture',
      engines: {fixture: engineProfile(server.baseUrl)},
      labelSuggestionShowInvalid: true,
    }),
  })

  const json = await runCli(project, ['label:suggest', 'QR text', '--json'])
  assert.equal(json.exitCode, 0, json.stderr)
  assert.deepEqual(parseJsonOutput(json), {
    invalidSuggestions: ['Select QR code type'],
    suggestions: ['select_qr_code_type'],
  })

  const text = await runCli(project, ['label:suggest', 'QR text'])
  assert.equal(text.exitCode, 0, text.stderr)
  assert.equal(
    text.stdout.trim(),
    ['select_qr_code_type', '', 'Invalid suggestions:', 'Select QR code type'].join('\n'),
  )
})

test('label:suggest flag overrides select count and engine', async testContext => {
  const primary = await startOpenAiServer(testContext, async () => completion(['primary_key']))
  const secondary = await startOpenAiServer(testContext, async () => completion(['secondary_key']))
  const project = await createProject(testContext, {
    config: createConfig({
      engine: 'primary',
      engines: {
        primary: engineProfile(primary.baseUrl),
        secondary: engineProfile(secondary.baseUrl),
      },
      labelSuggestionCount: 7,
    }),
  })

  const result = await runCli(project, [
    'label:suggest',
    'Choose',
    '--engine',
    'secondary',
    '--count',
    '12',
    '--json',
  ])

  assert.equal(result.exitCode, 0, result.stderr)
  assert.equal(primary.requests.length, 0)
  assert.equal(secondary.requests.length, 1)
  assert.match(secondary.requests[0].body.messages[1].content, /12 unique/)
  assert.deepEqual(parseJsonOutput(result), {suggestions: ['secondary_key']})
})

test('label:suggest reports usage errors before making an engine request', async testContext => {
  const server = await startOpenAiServer(testContext, async () => completion(['unused_key']))
  const base = {
    engine: 'fixture',
    engines: {fixture: engineProfile(server.baseUrl)},
  }
  const cases = [
    {arguments_: ['label:suggest', 'Text', '--count', '0', '--json'], config: createConfig(base)},
    {arguments_: ['label:suggest', 'Text', '--count=-1', '--json'], config: createConfig(base)},
    {arguments_: ['label:suggest', '--json'], config: createConfig(base)},
    {arguments_: ['label:suggest', 'Text', '--engine', 'missing', '--json'], config: createConfig(base)},
    {arguments_: ['label:suggest', 'Text', '--json'], config: createConfig({...base, labelSuggestionCount: '5'})},
    {arguments_: ['label:suggest', 'Text', '--json'], config: createConfig({...base, labelSuggestionShowInvalid: 'yes'})},
    {arguments_: ['label:suggest', 'Text', '--json'], config: createConfig({...base, labelValidation: '['})},
  ]

  for (const item of cases) {
    const project = await createProject(testContext, {config: item.config})
    const result = await runCli(project, item.arguments_)
    assert.equal(result.exitCode, 2, `${item.arguments_.join(' ')}: ${result.stderr}`)
  }

  assert.equal(server.requests.length, 0)
})

test('label:suggest rejects empty and malformed engine completions', async testContext => {
  for (const content of ['[]', 'not json']) {
    const server = await startOpenAiServer(testContext, async () => ({
      body: {choices: [{message: {content}}]},
      status: 200,
    }))
    const project = await createProject(testContext, {
      config: createConfig({
        engine: 'fixture',
        engines: {fixture: engineProfile(server.baseUrl)},
      }),
    })

    const result = await runCli(project, ['label:suggest', 'Text', '--json'])
    assert.equal(result.exitCode, 1, result.stderr)
    assert.match(JSON.stringify(parseJsonOutput(result)), /label suggestion completion/i)
  }
})
