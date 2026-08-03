import assert from 'node:assert/strict'
import fs from 'node:fs'
import {test} from 'node:test'

import {
  createTemporaryProject,
  readBytes,
  readJson,
  runCli,
  writeText,
} from '../helpers/project-fixture.mjs'

const initArguments = ['init', '--minimal', '--languages', 'en,uk', '--source', 'en']

test('init creates a minimal project with configured language files', async testContext => {
  const project = await createTemporaryProject(testContext)

  const result = await runCli(project, initArguments)

  assert.equal(result.exitCode, 0, result.stderr)
  const config = await readJson(project.configFile)
  assert.deepEqual(config.languages, ['en', 'uk'])
  assert.equal(config.langCodeDefault, 'en')
  assert.deepEqual(await readJson(project.file('en')), {})
  assert.deepEqual(await readJson(project.file('uk')), {})
})

test('init refuses to overwrite an existing project', async testContext => {
  const project = await createTemporaryProject(testContext)
  assert.equal((await runCli(project, initArguments)).exitCode, 0)
  const configBefore = await readBytes(project.configFile)
  const enBefore = await readBytes(project.file('en'))
  const ukBefore = await readBytes(project.file('uk'))

  const result = await runCli(project, initArguments)

  assert.equal(result.exitCode, 2)
  assert.match(result.stderr, /Configuration already exists/)
  assert.deepEqual(await readBytes(project.configFile), configBefore)
  assert.deepEqual(await readBytes(project.file('en')), enBefore)
  assert.deepEqual(await readBytes(project.file('uk')), ukBefore)
})

test('init --force recreates configuration and language files', async testContext => {
  const project = await createTemporaryProject(testContext)
  assert.equal((await runCli(project, initArguments)).exitCode, 0)
  await writeText(project.file('en'), '{"changed":"source"}\n')
  await writeText(project.file('uk'), '{"changed":"target"}\n')
  await fs.promises.writeFile(project.configFile, '{"changed":true}\n')

  const result = await runCli(project, [...initArguments, '--force'])

  assert.equal(result.exitCode, 0, result.stderr)
  const config = await readJson(project.configFile)
  assert.deepEqual(config.languages, ['en', 'uk'])
  assert.equal(config.langCodeDefault, 'en')
  assert.deepEqual(await readJson(project.file('en')), {})
  assert.deepEqual(await readJson(project.file('uk')), {})
})
