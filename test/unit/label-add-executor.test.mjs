import assert from 'node:assert/strict'
import fs from 'node:fs'
import {test} from 'node:test'

import {LabelAddExecutor} from '../../dist/shared/label-add-executor.js'
import {LabelAddPlanner} from '../../dist/shared/label-add-planner.js'
import {LabelAddRepository} from '../../dist/shared/label-add.repository.js'
import {
  createConfig,
  createProject,
  pathExists,
  readBytes,
  readJson,
  writeText,
} from '../helpers/project-fixture.mjs'

const resultFor = (request, translatedText) => ({
  ...request,
  cached: false,
  engine: 'fixture',
  model: 'fixture-model',
  provider: 'openai-compatible',
  translatedText,
})

const batchFor = (results, overrides = {}) => ({
  conflicts: [],
  failed: [],
  incomplete: [],
  remaining: [],
  results,
  skipped: [],
  summary: {cached: 0, conflict: 0, failed: 0, remaining: 0, skipped: 0, translated: results.length},
  ...overrides,
})

const loadPlan = async (project, input) => {
  const snapshot = await LabelAddRepository.load(project.config, {cwd: project.root})
  return {plan: LabelAddPlanner.create(snapshot, input), snapshot}
}

test('atomically adds complete translations and generates types from final default dictionary', async testContext => {
  const project = await createProject(testContext, {
    config: createConfig({languages: ['en', 'uk', 'de'], source: 'en'}),
    dictionaries: {
      de: {btn: {world: 'Bestehend'}},
      en: {home: {title: 'Home'}},
      uk: {},
    },
  })
  const {plan, snapshot} = await loadPlan(project, {
    autoTranslate: true,
    key: 'btn.world',
    source: 'uk',
    sourceText: 'Привіт, світ!',
  })

  await LabelAddExecutor.apply({
    batch: batchFor(plan.requests.map(request => resultFor(request, 'Hello world!'))),
    plan,
    snapshot,
  })

  assert.equal((await readJson(project.file('uk'))).btn.world, 'Привіт, світ!')
  assert.equal((await readJson(project.file('en'))).btn.world, 'Hello world!')
  assert.equal((await readJson(project.file('de'))).btn.world, 'Bestehend')
  const types = await fs.promises.readFile(project.typesFile, 'utf8')
  assert.match(types, /'btn\.world'/)
  assert.match(types, /'home\.title'/)
})

test('adds empty strings to missing targets without a translation batch', async testContext => {
  const project = await createProject(testContext, {
    dictionaries: {de: {btn: {world: 'Bestehend'}}, en: {}, uk: {}},
  })
  const {plan, snapshot} = await loadPlan(project, {
    autoTranslate: false,
    key: 'btn.world',
    source: 'uk',
    sourceText: 'Привіт, світ!',
  })

  await LabelAddExecutor.apply({batch: null, plan, snapshot})

  assert.equal((await readJson(project.file('en'))).btn.world, '')
  assert.equal((await readJson(project.file('uk'))).btn.world, 'Привіт, світ!')
  assert.equal((await readJson(project.file('de'))).btn.world, 'Bestehend')
})

test('rejects every incomplete translation outcome without writes', async testContext => {
  const project = await createProject(testContext)
  await writeText(project.typesFile, 'original types\n')
  const before = await Promise.all(project.config.languages.map(language => readBytes(project.file(language))))
  const typesBefore = await readBytes(project.typesFile)
  const {plan, snapshot} = await loadPlan(project, {
    autoTranslate: true,
    key: 'btn.world',
    source: 'uk',
    sourceText: 'Привіт, світ!',
  })
  const request = plan.requests[0]
  const cases = [
    batchFor([], {failed: [{attempts: 1, category: 'provider_response', message: 'failed', request}]}),
    batchFor([], {remaining: [{reason: 'limit', request}]}),
    batchFor([], {skipped: [{reason: 'url', request}]}),
    batchFor([], {conflicts: [{request, result: resultFor(request, 'Hello'), sourcePlaceholders: [], translatedPlaceholders: []}]}),
  ]

  for (const batch of cases) {
    await assert.rejects(LabelAddExecutor.apply({batch, plan, snapshot}), /complete|conflict|failed|remaining|skipped/i)
  }

  for (const [index, language] of project.config.languages.entries()) {
    assert.deepEqual(await readBytes(project.file(language)), before[index])
  }

  assert.deepEqual(await readBytes(project.typesFile), typesBefore)
})

test('rejects missing, duplicate, or unexpected translation results without writes', async testContext => {
  const project = await createProject(testContext)
  const {plan, snapshot} = await loadPlan(project, {
    autoTranslate: true,
    key: 'btn.world',
    source: 'uk',
    sourceText: 'Привіт, світ!',
  })
  const before = await Promise.all(project.config.languages.map(language => readBytes(project.file(language))))
  const valid = plan.requests.map(request => resultFor(request, `${request.to}: translated`))
  const unexpectedRequest = {...plan.requests[0], to: 'fr'}
  const cases = [
    batchFor(valid.slice(0, -1)),
    batchFor([...valid, valid[0]]),
    batchFor([...valid, resultFor(unexpectedRequest, 'inattendu')]),
  ]

  for (const batch of cases) {
    await assert.rejects(LabelAddExecutor.apply({batch, plan, snapshot}), /translation result|complete|duplicate|unexpected/i)
  }

  for (const [index, language] of project.config.languages.entries()) {
    assert.deepEqual(await readBytes(project.file(language)), before[index])
  }

  assert.equal(pathExists(project.typesFile), false)
})

test('stale snapshot prevents overwriting a concurrent dictionary edit', async testContext => {
  const project = await createProject(testContext)
  const {plan, snapshot} = await loadPlan(project, {
    autoTranslate: false,
    key: 'btn.world',
    source: 'uk',
    sourceText: 'Привіт, світ!',
  })
  const ukBefore = await readBytes(project.file('uk'))
  await writeText(project.file('en'), '{"concurrent":"edit"}\n')

  await assert.rejects(
    LabelAddExecutor.apply({batch: null, plan, snapshot}),
    /File changed after sync planning/,
  )

  assert.deepEqual(await readJson(project.file('en')), {concurrent: 'edit'})
  assert.deepEqual(await readBytes(project.file('uk')), ukBefore)
  assert.equal(pathExists(project.typesFile), false)
})
