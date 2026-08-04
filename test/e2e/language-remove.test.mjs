import assert from 'node:assert/strict'
import fs from 'node:fs'
import {test} from 'node:test'

import {
  createConfig,
  createProject,
  pathExists,
  readBytes,
  readJson,
  runCli,
  writeText,
} from '../helpers/project-fixture.mjs'

const removeConfig = () => createConfig({
  languages: ['en', 'es', 'uk'],
  source: 'en',
})

test('language:remove --force deletes the language file by default', async testContext => {
  const project = await createProject(testContext, {config: removeConfig()})

  const result = await runCli(project, ['language:remove', 'es', '--force'])

  assert.equal(result.exitCode, 0, result.stderr)
  assert.equal(pathExists(project.file('es')), false)
  assert.deepEqual((await readJson(project.configFile)).languages, ['en', 'uk'])
  const types = await fs.promises.readFile(project.typesFile, 'utf8')
  assert.doesNotMatch(types, /ES = 'es'/)
})

test('language:remove --keep-file preserves the language file', async testContext => {
  const project = await createProject(testContext, {config: removeConfig()})

  const result = await runCli(project, ['language:remove', 'es', '--keep-file'])

  assert.equal(result.exitCode, 0, result.stderr)
  assert.equal(pathExists(project.file('es')), true)
  assert.deepEqual((await readJson(project.configFile)).languages, ['en', 'uk'])
  assert.match(result.stdout, /Preserved:/)
})

test('language:remove without --force is safe non-interactively', async testContext => {
  const project = await createProject(testContext, {config: removeConfig()})
  await writeText(project.typesFile, 'existing types\n')
  const configBefore = await readBytes(project.configFile)
  const dictionaryBefore = await readBytes(project.file('es'))
  const typesBefore = await readBytes(project.typesFile)

  const result = await runCli(project, ['language:remove', 'es'])

  assert.equal(result.exitCode, 2)
  assert.match(result.stderr, /Non-interactive file deletion requires --force/)
  assert.deepEqual(await readBytes(project.configFile), configBefore)
  assert.deepEqual(await readBytes(project.file('es')), dictionaryBefore)
  assert.deepEqual(await readBytes(project.typesFile), typesBefore)
})

test('language:remove accepts the legacy --delete-file flag', async testContext => {
  const project = await createProject(testContext, {config: removeConfig()})

  const result = await runCli(project, ['language:remove', 'es', '--delete-file', '--force'])

  assert.equal(result.exitCode, 0, result.stderr)
  assert.equal(pathExists(project.file('es')), false)
})

test('language:remove rejects conflicting file flags before writes', async testContext => {
  const project = await createProject(testContext, {config: removeConfig()})
  const configBefore = await readBytes(project.configFile)
  const dictionaryBefore = await readBytes(project.file('es'))

  const result = await runCli(project, [
    'language:remove',
    'es',
    '--keep-file',
    '--delete-file',
    '--force',
  ])

  assert.equal(result.exitCode, 2)
  assert.deepEqual(await readBytes(project.configFile), configBefore)
  assert.deepEqual(await readBytes(project.file('es')), dictionaryBefore)
})

test('language:remove still requires a replacement for the source language', async testContext => {
  const project = await createProject(testContext, {config: removeConfig()})
  const configBefore = await readBytes(project.configFile)

  const result = await runCli(project, ['language:remove', 'en', '--force'])

  assert.equal(result.exitCode, 2)
  assert.match(result.stderr, /requires --source/)
  assert.deepEqual(await readBytes(project.configFile), configBefore)
  assert.equal(pathExists(project.file('en')), true)
})
