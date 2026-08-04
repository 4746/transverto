import assert from 'node:assert/strict'
import {test} from 'node:test'

import {TranslationError} from '../../dist/shared/entities/translation-error.js'
import {TranslationBatchService} from '../../dist/shared/translation-batch.service.js'

const config = (overrides = {}) => ({
  concurrency: 2, delayMs: 0, maxChars: null, maxItems: null,
  mode: 'multi-language', retry: 0, ...overrides,
})
const requests = [
  {from: 'en', key: 'language', sourceText: 'Language', to: 'uk'},
  {from: 'en', key: 'language', sourceText: 'Language', to: 'de'},
]
const result = (request, to, translatedText = `${to}: Language`) => ({
  cached: false, engine: 'fixture', from: request.from, key: request.key,
  model: 'fixture-model', provider: 'openai-compatible', sourceText: request.sourceText,
  to, translatedText,
})
const complete = request => ({
  issues: [], request, results: request.targets.map(to => result(request, to)),
  translations: {}, unexpectedTargets: [],
})

test('groups one source and multiple targets into one package', async () => {
  const packages = []; const cached = []
  const executor = {
    cacheResults: async results => cached.push(...results),
    translate: async () => assert.fail('single translation was not expected'),
    async translateBatch(request) { packages.push(request); return complete(request) },
  }
  const output = await new TranslationBatchService(executor).execute(requests, {config: config(), dryRun: false})
  assert.deepEqual(packages.map(item => item.targets), [['uk', 'de']])
  assert.deepEqual(output.results.map(item => item.to), ['uk', 'de'])
  assert.equal(cached.length, 2)
})

test('recovers only invalid targets when approved', async () => {
  const singles = []
  const executor = {
    async cacheResults() {},
    async translate(request) { singles.push(request.to); return result(request, request.to, 'Sprache') },
    translateBatch: async request => ({
      issues: [{reason: 'missing', target: 'de'}], request,
      results: [result(request, 'uk', 'Мова')], translations: {}, unexpectedTargets: [],
    }),
  }
  const output = await new TranslationBatchService(executor).execute(requests, {
    config: config(), dryRun: false, onIncomplete: async () => 'per-language',
  })
  assert.deepEqual(singles, ['de'])
  assert.deepEqual(output.results.map(item => item.to), ['uk', 'de'])
  assert.equal(output.incomplete[0].decision, 'per-language')
})

test('cancel discards every result and fresh cache write', async () => {
  let commits = 0
  const executor = {
    async cacheResults() { commits += 1 },
    translate: async () => assert.fail('single recovery must not run'),
    translateBatch: async request => ({
      issues: [{reason: 'missing', target: 'de'}], request,
      results: [result(request, 'uk', 'Мова')], translations: {}, unexpectedTargets: [],
    }),
  }
  const output = await new TranslationBatchService(executor).execute(requests, {config: config(), dryRun: false})
  assert.equal(commits, 0)
  assert.deepEqual(output.results, [])
  assert.equal(output.remaining.every(item => item.reason === 'incomplete_batch'), true)
})

test('retries the complete package after a recoverable error', async () => {
  const seen = []
  const executor = {
    async cacheResults() {},
    translate: async () => assert.fail('single translation was not expected'),
    async translateBatch(request) {
      seen.push([...request.targets])
      if (seen.length === 1) throw new TranslationError('rate_limit', 'slow down')
      return complete(request)
    },
  }
  await new TranslationBatchService(executor, {async sleep() {}}).execute(requests, {
    config: config({retry: 1}), dryRun: false,
  })
  assert.deepEqual(seen, [['uk', 'de'], ['uk', 'de']])
})
