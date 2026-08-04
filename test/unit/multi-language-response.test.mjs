import assert from 'node:assert/strict'
import {test} from 'node:test'

import {OpenAICompatibleEngine} from '../../dist/shared/engines/openai-compatible.engine.js'
import {parseMultiLanguageCompletion} from '../../dist/shared/multi-language-response.js'

test('parses requested translations in requested order', () => {
  assert.deepEqual(
    parseMultiLanguageCompletion('{"de":"Sprache","uk":"Мова"}', ['uk', 'de']),
    {issues: [], translations: {uk: 'Мова', de: 'Sprache'}, unexpectedTargets: []},
  )
})

test('classifies missing, empty, non-string, and unexpected targets', () => {
  assert.deepEqual(
    parseMultiLanguageCompletion('{"uk":"Мова","de":"","fr":5,"xx":"extra"}', ['uk', 'de', 'fr', 'es']),
    {
      issues: [
        {reason: 'empty', target: 'de'},
        {reason: 'non_string', target: 'fr'},
        {reason: 'missing', target: 'es'},
      ],
      translations: {uk: 'Мова'},
      unexpectedTargets: ['xx'],
    },
  )
})

test('classifies malformed and non-object completions for every target', () => {
  assert.deepEqual(parseMultiLanguageCompletion('```json\n{}\n```', ['uk', 'de']).issues, [
    {reason: 'malformed_json', target: 'uk'},
    {reason: 'malformed_json', target: 'de'},
  ])
  assert.deepEqual(parseMultiLanguageCompletion('[]', ['uk']).issues, [
    {reason: 'not_object', target: 'uk'},
  ])
})

test('engine uses one JSON-only completion for all requested targets', async () => {
  const requests = []
  const fetchImplementation = async (url, init) => {
    requests.push({body: JSON.parse(init.body), url})
    return new Response(JSON.stringify({
      choices: [{message: {content: '{"uk":"Мова","de":"Sprache"}'}}],
    }), {headers: {'content-type': 'application/json'}, status: 200})
  }
  const engine = new OpenAICompatibleEngine({
    baseUrl: 'http://fixture.test/v1',
    model: 'fixture-model',
    name: 'fixture',
    provider: 'openai-compatible',
    timeoutMs: 1000,
  }, fetchImplementation)

  const result = await engine.translateBatch({
    from: 'en', key: 'label.language', sourceText: 'Language', targets: ['uk', 'de'],
  })

  assert.equal(requests.length, 1)
  const system = requests[0].body.messages[0].content
  assert.match(system, /Return exactly one JSON object/)
  assert.match(system, /uk, de/)
  assert.deepEqual(result.translations, {uk: 'Мова', de: 'Sprache'})
})
