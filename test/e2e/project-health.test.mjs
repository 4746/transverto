import assert from 'node:assert/strict'
import {test} from 'node:test'

import {
  createConfig,
  createProject,
  parseJsonOutput,
  runCli,
  writeText,
} from '../helpers/project-fixture.mjs'

const dictionaries = {
  en: {
    date: {forms: {day: ['Day', 'Days']}},
    empty: 'Empty',
    greeting: 'Hello {name}',
    ready: 'Ready',
  },
  uk: {
    date: {forms: {day: ['День', 'Дні', 'Днів']}},
    extra: 'Зайве',
    greeting: 'Привіт',
    ready: 'Ready',
  },
}

test('status reports critical translation problems and honors filters', async testContext => {
  const project = await createProject(testContext, {dictionaries})

  const result = await runCli(project, ['status', '--json'])
  assert.equal(result.exitCode, 1)
  const report = parseJsonOutput(result)
  assert.deepEqual(
    [...new Set(report.findings.map(finding => finding.problem))].sort(),
    ['extra', 'missing', 'placeholder', 'same'],
  )

  const filteredResult = await runCli(project, [
    'status',
    '--language', 'uk',
    '--problem', 'placeholder',
    '--fail-on', 'never',
    '--json',
  ])
  assert.equal(filteredResult.exitCode, 0, filteredResult.stderr)
  const filtered = parseJsonOutput(filteredResult)
  assert.equal(filtered.findings.length, 1)
  assert.equal(filtered.findings[0].key, 'greeting')
  assert.equal(filtered.findings[0].language, 'uk')
  assert.equal(filtered.findings[0].problem, 'placeholder')
})

test('doctor reports a healthy offline project without checking the engine', async testContext => {
  const config = createConfig({
    engine: 'fixture',
    engines: {
      fixture: {
        baseUrl: 'http://127.0.0.1:9/v1',
        model: 'fixture-model',
        provider: 'lmstudio',
      },
    },
  })
  const project = await createProject(testContext, {config, dictionaries})

  const result = await runCli(project, ['doctor', '--json'])

  assert.equal(result.exitCode, 0, result.stderr)
  const report = parseJsonOutput(result)
  assert.equal(report.exitCode, 0)
  assert.equal(report.summary.error, 0)
  assert.equal(report.summary.warning, 0)
  assert.equal(report.diagnostics.some(item => item.code === 'ENGINE_UNAVAILABLE'), false)
})

test('doctor returns a stable error report for an invalid language dictionary', async testContext => {
  const config = createConfig({
    engine: 'fixture',
    engines: {
      fixture: {
        baseUrl: 'http://127.0.0.1:9/v1',
        model: 'fixture-model',
        provider: 'lmstudio',
      },
    },
  })
  const project = await createProject(testContext, {config, dictionaries})
  await writeText(project.file('uk'), '{invalid json\n')

  const result = await runCli(project, ['doctor', '--json'])

  assert.equal(result.exitCode, 2)
  const report = parseJsonOutput(result)
  assert.equal(report.exitCode, 2)
  assert.equal(report.summary.error, 1)
  const diagnostic = report.diagnostics.find(item => item.code === 'LANGUAGE_JSON_INVALID')
  assert.ok(diagnostic)
  assert.equal(diagnostic.file, project.file('uk'))
})
