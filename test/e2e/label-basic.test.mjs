import assert from 'node:assert/strict'
import {test} from 'node:test'

import {
  createProject,
  parseJsonOutput,
  readBytes,
  readJson,
  runCli,
} from '../helpers/project-fixture.mjs'

const dictionaries = {
  en: {home: {title: 'Hello'}},
  uk: {home: {title: 'Привіт'}},
}

test('label add, get, and replace update and expose real dictionary state', async testContext => {
  const project = await createProject(testContext, {dictionaries})

  const add = await runCli(project, [
    'label:add', 'home.subtitle',
    '-f', 'en',
    '-t', 'Welcome',
    '--no-auto-translate',
    '--silent',
  ])
  assert.equal(add.exitCode, 0, add.stderr)
  assert.equal((await readJson(project.file('en'))).home.subtitle, 'Welcome')
  assert.equal((await readJson(project.file('uk'))).home.subtitle, '')

  const get = await runCli(project, ['label:get', 'home', '--mode', 'prefix', '--json'])
  assert.equal(get.exitCode, 0, get.stderr)
  assert.deepEqual(parseJsonOutput(get).results.map(item => item.key), [
    'home.subtitle',
    'home.title',
  ])

  const replace = await runCli(project, [
    'label:replace', 'home.title',
    '-f', 'uk',
    '-t', 'Вітаю',
  ])
  assert.equal(replace.exitCode, 0, replace.stderr)
  assert.equal((await readJson(project.file('uk'))).home.title, 'Вітаю')
})

test('label get requires a query non-interactively and preserves dictionaries', async testContext => {
  const project = await createProject(testContext, {dictionaries})
  const enBefore = await readBytes(project.file('en'))
  const ukBefore = await readBytes(project.file('uk'))

  const result = await runCli(project, ['label:get', '--json'])

  assert.equal(result.exitCode, 2)
  assert.match(parseJsonOutput(result).error.message, /Missing search query/)
  assert.deepEqual(await readBytes(project.file('en')), enBefore)
  assert.deepEqual(await readBytes(project.file('uk')), ukBefore)
})
