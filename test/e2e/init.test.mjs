import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {test} from 'node:test'

import {CTV_CONFIG_SCHEMA_PATH} from '../../dist/shared/constants.js'
import {
  createTemporaryProject,
  pathExists,
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
  const configText = await fs.promises.readFile(project.configFile, 'utf8')
  const config = JSON.parse(configText)
  assert.equal(config.$schema, CTV_CONFIG_SCHEMA_PATH)
  assert.match(configText, /^\{\n {2}"\$schema":/)
  assert.deepEqual(config.languages, ['en', 'uk'])
  assert.equal(config.langCodeDefault, 'en')
  assert.deepEqual(await readJson(project.file('en')), {})
  assert.deepEqual(await readJson(project.file('uk')), {})
  const types = await fs.promises.readFile(project.typesFile, 'utf8')
  assert.match(types, /EN = 'en'/)
  assert.match(types, /UK = 'uk'/)
  assert.match(types, /export type TLanguageLabel = never;/)
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

test('init generates types from a preserved source dictionary', async testContext => {
  const project = await createTemporaryProject(testContext)
  await writeText(project.file('en'), '{"home":{"title":"Hello"}}\n')

  const result = await runCli(project, initArguments)

  assert.equal(result.exitCode, 0, result.stderr)
  assert.deepEqual(await readJson(project.file('en')), {home: {title: 'Hello'}})
  const types = await fs.promises.readFile(project.typesFile, 'utf8')
  assert.match(types, /export type TLanguageLabel = 'home\.title';/)
})

test('init --force recreates configuration and language files', async testContext => {
  const project = await createTemporaryProject(testContext)
  assert.equal((await runCli(project, initArguments)).exitCode, 0)
  await writeText(project.file('en'), '{"changed":"source"}\n')
  await writeText(project.file('uk'), '{"changed":"target"}\n')
  await writeText(project.typesFile, 'stale types\n')
  await fs.promises.writeFile(project.configFile, '{"changed":true}\n')

  const result = await runCli(project, [...initArguments, '--force'])

  assert.equal(result.exitCode, 0, result.stderr)
  const config = await readJson(project.configFile)
  assert.deepEqual(config.languages, ['en', 'uk'])
  assert.equal(config.langCodeDefault, 'en')
  assert.deepEqual(await readJson(project.file('en')), {})
  assert.deepEqual(await readJson(project.file('uk')), {})
  const types = await fs.promises.readFile(project.typesFile, 'utf8')
  assert.doesNotMatch(types, /stale types/)
  assert.match(types, /export type TLanguageLabel = never;/)
})

test('init --no-files does not create language or types files', async testContext => {
  const project = await createTemporaryProject(testContext)

  const result = await runCli(project, [...initArguments, '--no-files'])

  assert.equal(result.exitCode, 0, result.stderr)
  assert.equal(pathExists(project.configFile), true)
  assert.equal(pathExists(project.file('en')), false)
  assert.equal(pathExists(project.file('uk')), false)
  assert.equal(pathExists(project.typesFile), false)
  assert.equal(pathExists(path.dirname(project.typesFile)), false)
})

test('init fails when a preserved source dictionary is malformed', async testContext => {
  const project = await createTemporaryProject(testContext)
  await writeText(project.file('en'), '{invalid json\n')

  const result = await runCli(project, initArguments)

  assert.notEqual(result.exitCode, 0)
  assert.equal(pathExists(project.typesFile), false)
})
