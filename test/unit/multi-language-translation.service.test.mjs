import assert from 'node:assert/strict'
import path from 'node:path'
import {test} from 'node:test'

import {TranslationService} from '../../dist/shared/translation.service.js'
import {startOpenAiServer} from '../helpers/http-server.mjs'
import {createConfig, createTemporaryProject} from '../helpers/project-fixture.mjs'

const serviceFor = (project, baseUrl, overrides = {}) => TranslationService.fromConfig(
  createConfig({
    engine: 'fixture',
    engines: {fixture: {baseUrl, model: 'fixture-model', provider: 'openai-compatible'}},
    ...overrides,
  }),
  {cacheFile: path.join(project.cacheRoot, 'translations.json')},
)

test('translateBatch returns fresh results without caching before commit', async testContext => {
  const server = await startOpenAiServer(testContext, () => ({
    body: {choices: [{message: {content: '{"uk":"Привіт {name}","de":"Hallo {name}"}'}}]},
    status: 200,
  }))
  const project = await createTemporaryProject(testContext)
  const service = serviceFor(project, server.baseUrl)
  const request = {from: 'en', key: 'hello', sourceText: 'Hello {name}', targets: ['uk', 'de']}

  const first = await service.translateBatch(request)
  await service.translateBatch(request)
  assert.equal(server.requests.length, 2)
  assert.equal(first.results.every(result => !result.cached), true)
  assert.deepEqual(first.issues, [])

  await service.cacheResults(first.results)
  const cached = await service.translateBatch(request)
  assert.equal(server.requests.length, 2)
  assert.equal(cached.results.every(result => result.cached), true)
})

test('translate can defer fresh cache writes until an explicit commit', async testContext => {
  const server = await startOpenAiServer(testContext, () => ({
    body: {choices: [{message: {content: 'Привіт'}}]}, status: 200,
  }))
  const project = await createTemporaryProject(testContext)
  const service = TranslationService.fromConfig(createConfig({
    engine: 'fixture',
    engines: {fixture: {baseUrl: server.baseUrl, model: 'fixture-model', provider: 'openai-compatible'}},
  }), {cacheFile: path.join(project.cacheRoot, 'translations.json'), deferCacheWrites: true})
  const request = {from: 'en', key: 'hello', sourceText: 'Hello', to: 'uk'}

  const first = await service.translate(request)
  await service.translate(request)
  assert.equal(server.requests.length, 2)

  await service.cacheResults([first])
  assert.equal((await service.translate(request)).cached, true)
  assert.equal(server.requests.length, 2)
})

test('translateBatch converts placeholder mismatches into target issues', async testContext => {
  const server = await startOpenAiServer(testContext, () => ({
    body: {choices: [{message: {content: '{"uk":"Привіт","de":"Hallo {name}"}'}}]},
    status: 200,
  }))
  const project = await createTemporaryProject(testContext)
  const attempt = await serviceFor(project, server.baseUrl).translateBatch({
    from: 'en', sourceText: 'Hello {name}', targets: ['uk', 'de'],
  })

  assert.deepEqual(attempt.issues, [{reason: 'placeholder', target: 'uk'}])
  assert.deepEqual(attempt.results.map(result => result.to), ['de'])
})

test('translateBatch sends a recoverable full-package failure to fallback', async testContext => {
  const primary = await startOpenAiServer(testContext, () => ({body: {error: {message: 'down'}}, status: 500}))
  const fallback = await startOpenAiServer(testContext, () => ({
    body: {choices: [{message: {content: '{"uk":"Мова","de":"Sprache"}'}}]}, status: 200,
  }))
  const project = await createTemporaryProject(testContext)
  const service = TranslationService.fromConfig(createConfig({
    engine: 'primary', engines: {
      fallback: {baseUrl: fallback.baseUrl, model: 'fallback-model', provider: 'openai-compatible'},
      primary: {baseUrl: primary.baseUrl, model: 'primary-model', provider: 'openai-compatible'},
    },
    fallback: 'fallback',
  }), {cacheFile: path.join(project.cacheRoot, 'translations.json')})

  const attempt = await service.translateBatch({from: 'en', sourceText: 'Language', targets: ['uk', 'de']})
  assert.equal(primary.requests.length, 1)
  assert.equal(fallback.requests.length, 1)
  assert.equal(attempt.results.every(result => result.engine === 'fallback'), true)
  assert.equal(attempt.results.every(result => result.fallback.from === 'primary'), true)
})
