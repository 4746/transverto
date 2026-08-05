import assert from 'node:assert/strict'
import {test} from 'node:test'

import {OpenAICompatibleEngine} from '../../dist/shared/engines/openai-compatible.engine.js'

const requestBodyFor = async (overrides = {}, batch = false) => {
  const requests = []
  const fetchImplementation = async (_url, init) => {
    requests.push(JSON.parse(init.body))

    const content = batch ? '{"uk":"Мова","de":"Sprache"}' : 'Мова'

    return new Response(JSON.stringify({choices: [{message: {content}}]}), {status: 200})
  }

  const engine = new OpenAICompatibleEngine({
    baseUrl: 'http://fixture.test/v1',
    model: 'fixture-model',
    name: 'fixture',
    provider: 'openai-compatible',
    timeoutMs: 1000,
    ...overrides,
  }, fetchImplementation)

  await (batch
    ? engine.translateBatch({
      from: 'en', key: 'label.language', sourceText: 'Language', targets: ['uk', 'de'],
    })
    : engine.translate({from: 'en', key: 'label.language', sourceText: 'Language', to: 'uk'}))

  assert.equal(requests.length, 1)
  return requests[0]
}

const suggestionRequestBodyFor = async (overrides = {}) => {
  const requests = []
  const fetchImplementation = async (_url, init) => {
    requests.push(JSON.parse(init.body))
    return new Response(JSON.stringify({
      choices: [{message: {content: '["select_qr_code_type"]'}}],
    }), {status: 200})
  }

  const engine = new OpenAICompatibleEngine({
    baseUrl: 'http://fixture.test/v1',
    model: 'fixture-model',
    name: 'fixture',
    provider: 'openai-compatible',
    timeoutMs: 1000,
    ...overrides,
  }, fetchImplementation)

  const suggestions = await engine.suggestLabels({
    count: 7,
    labelValidation: String.raw`^[a-z0-9\._]{2,100}$`,
    text: 'Обрати тип QR-коду',
  })

  assert.deepEqual(suggestions, ['select_qr_code_type'])
  assert.equal(requests.length, 1)
  return requests[0]
}

test('old profile keeps empty system message, user translation task, and temperature zero', async () => {
  const body = await requestBodyFor()
  assert.equal(body.messages[0].role, 'system')
  assert.equal(body.messages[0].content, '')
  assert.equal(body.messages[1].role, 'user')
  assert.match(body.messages[1].content, /Target language: uk/)
  assert.match(body.messages[1].content, /Source text: Language/)
  assert.equal(body.temperature, 0)
  assert.equal(Object.hasOwn(body, 'reasoning'), false)
  assert.equal(Object.hasOwn(body, 'reasoning_effort'), false)
})

test('profile system prompt and temperature reach single and batch requests', async () => {
  for (const batch of [false, true]) {
    const body = await requestBodyFor({
      systemPrompt: 'Profile-specific system prompt',
      temperature: 0.35,
    }, batch)
    assert.equal(body.messages[0].content, 'Profile-specific system prompt')
    assert.equal(body.temperature, 0.35)
    assert.match(body.messages[1].content, batch
      ? /Return exactly one JSON object/
      : /Return only the translated source text/)
  }
})

test('label suggestion request uses its feature prompt and strict output instructions', async () => {
  const body = await suggestionRequestBodyFor({
    labelSuggestionPrompt: 'Label-only prompt',
    systemPrompt: 'Translation-only prompt',
  })

  assert.equal(body.messages[0].content, 'Label-only prompt')
  assert.match(body.messages[1].content, /Обрати тип QR-коду/)
  assert.match(body.messages[1].content, /7 unique/)
  assert.match(body.messages[1].content, /English/)
  assert.match(body.messages[1].content, /\^\[a-z0-9/)
  assert.match(body.messages[1].content, /JSON array/)
})

test('label suggestion request has a built-in system prompt independent of translation', async () => {
  const body = await suggestionRequestBodyFor({systemPrompt: 'Translation-only prompt'})
  assert.notEqual(body.messages[0].content, '')
  assert.notEqual(body.messages[0].content, 'Translation-only prompt')
})

test('reasoning false maps to each provider dialect', async () => {
  const cases = [
    ['openrouter', {reasoning: {enabled: false}}],
    ['google-ai', {'reasoning_effort': 'none'}],
    ['lmstudio', {'reasoning_effort': 'none'}],
    ['openai-compatible', {'reasoning_effort': 'none'}],
  ]

  for (const [provider, expected] of cases) {
    const body = await requestBodyFor({provider, reasoning: false})
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(body[key], value)
    if (provider === 'openrouter') assert.equal(Object.hasOwn(body, 'reasoning_effort'), false)
    else assert.equal(Object.hasOwn(body, 'reasoning'), false)
  }
})

test('reasoning true explicitly enables OpenRouter and leaves other providers at defaults', async () => {
  const openrouter = await requestBodyFor({provider: 'openrouter', reasoning: true})
  assert.deepEqual(openrouter.reasoning, {enabled: true})

  for (const provider of ['google-ai', 'lmstudio', 'openai-compatible']) {
    const body = await requestBodyFor({provider, reasoning: true})
    assert.equal(Object.hasOwn(body, 'reasoning'), false)
    assert.equal(Object.hasOwn(body, 'reasoning_effort'), false)
  }
})
