import assert from 'node:assert/strict'
import {test} from 'node:test'

import {startOpenAiServer} from '../helpers/http-server.mjs'
import {
  createConfig,
  createProject,
  parseJsonOutput,
  readBytes,
  readJson,
  runCli,
} from '../helpers/project-fixture.mjs'

const openAiResponse = content => ({
  choices: [{message: {content}}],
})

const translationConfig = (baseUrl, overrides = {}) => createConfig({
  engine: 'fixture',
  engines: {
    fixture: {
      baseUrl,
      model: 'fixture-model',
      provider: 'openai-compatible',
      timeoutMs: 1000,
    },
  },
  ...overrides,
})

test('translate uses the local provider, preserves placeholders, and reuses cache', async testContext => {
  const server = await startOpenAiServer(testContext, ({body}) => ({
    body: openAiResponse(body.messages.at(-1).content.includes('{name}')
      ? 'Привіт {name}'
      : 'Привіт'),
    status: 200,
  }))
  const project = await createProject(testContext, {
    config: translationConfig(server.baseUrl),
  })
  const arguments_ = [
    'translate', 'Hello {name}', '--from', 'en', '--to', 'uk', '--engine', 'fixture', '--json',
  ]

  const firstResult = await runCli(project, arguments_)
  assert.equal(firstResult.exitCode, 0, firstResult.stderr)
  const first = parseJsonOutput(firstResult)
  assert.equal(first.results.length, 1)
  assert.equal(first.results[0].translatedText, 'Привіт {name}')
  assert.equal(first.results[0].cached, false)
  assert.equal(first.results[0].engine, 'fixture')
  assert.equal(first.results[0].provider, 'openai-compatible')
  assert.equal(first.results[0].model, 'fixture-model')
  assert.equal(server.requests.length, 1)
  assert.equal(server.requests[0].url, '/v1/chat/completions')
  assert.equal(server.requests[0].body.messages.at(-1).content, 'Hello {name}')

  const secondResult = await runCli(project, arguments_)
  assert.equal(secondResult.exitCode, 0, secondResult.stderr)
  const second = parseJsonOutput(secondResult)
  assert.equal(second.results[0].translatedText, 'Привіт {name}')
  assert.equal(second.results[0].cached, true)
  assert.equal(server.requests.length, 1)
})

test('translate writes a safe key result to the target dictionary', async testContext => {
  const server = await startOpenAiServer(testContext, () => ({
    body: openAiResponse('Привіт {name}'),
    status: 200,
  }))
  const project = await createProject(testContext, {
    config: translationConfig(server.baseUrl),
    dictionaries: {
      en: {home: {title: 'Hello {name}'}},
      uk: {},
    },
  })

  const result = await runCli(project, [
    'translate', '--key', 'home.title', '--from', 'en', '--to', 'uk',
    '--engine', 'fixture', '--write', '--json',
  ])

  assert.equal(result.exitCode, 0, result.stderr)
  const report = parseJsonOutput(result)
  assert.equal(report.summary.translated, 1)
  assert.equal(report.conflicts.length, 0)
  assert.deepEqual(report.written, ['uk'])
  assert.equal((await readJson(project.file('uk'))).home.title, 'Привіт {name}')
  assert.equal(server.requests.length, 1)
})

test('translate rejects a placeholder conflict without writing', async testContext => {
  const server = await startOpenAiServer(testContext, () => ({
    body: openAiResponse('Привіт'),
    status: 200,
  }))
  const project = await createProject(testContext, {
    config: translationConfig(server.baseUrl),
    dictionaries: {
      en: {home: {title: 'Hello {name}'}},
      uk: {},
    },
  })
  const ukBefore = await readBytes(project.file('uk'))

  const result = await runCli(project, [
    'translate', '--key', 'home.title', '--from', 'en', '--to', 'uk',
    '--engine', 'fixture', '--write', '--json',
  ])

  assert.equal(result.exitCode, 1)
  const report = parseJsonOutput(result)
  assert.equal(report.summary.conflict, 1)
  assert.equal(report.results.length, 0)
  assert.deepEqual(report.written, [])
  assert.deepEqual(await readBytes(project.file('uk')), ukBefore)
  assert.equal(server.requests.length, 1)
})

test('translate reports a provider failure without retrying or writing', async testContext => {
  const server = await startOpenAiServer(testContext, () => ({
    body: {error: {message: 'fixture unavailable'}},
    status: 500,
  }))
  const project = await createProject(testContext, {
    config: translationConfig(server.baseUrl, {batch: {retry: 0}}),
    dictionaries: {
      en: {home: {title: 'Hello'}},
      uk: {},
    },
  })
  const ukBefore = await readBytes(project.file('uk'))

  const result = await runCli(project, [
    'translate', '--key', 'home.title', '--from', 'en', '--to', 'uk',
    '--engine', 'fixture', '--write', '--json',
  ])

  assert.equal(result.exitCode, 1)
  const report = parseJsonOutput(result)
  assert.equal(report.summary.failed, 1)
  assert.equal(report.failed[0].category, 'provider_unavailable')
  assert.deepEqual(report.written, [])
  assert.deepEqual(await readBytes(project.file('uk')), ukBefore)
  assert.equal(server.requests.length, 1)
})

test('multi-language mode uses one request for multiple targets', async testContext => {
  const server = await startOpenAiServer(testContext, () => ({
    body: openAiResponse(JSON.stringify({de: 'Sprache', uk: 'Мова'})), status: 200,
  }))
  const project = await createProject(testContext, {
    config: translationConfig(server.baseUrl, {batch: {mode: 'multi-language'}}),
  })
  const result = await runCli(project, [
    'translate', 'Language', '--from', 'en', '--to', 'uk', '--to', 'de', '--json',
  ])
  assert.equal(result.exitCode, 0, result.stderr)
  assert.equal(server.requests.length, 1)
  assert.deepEqual(parseJsonOutput(result).results.map(item => item.to), ['uk', 'de'])
})
