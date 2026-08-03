import assert from 'node:assert/strict'
import {test} from 'node:test'

import {
  createProject,
  parseJsonOutput,
  readBytes,
  readJson,
  runCli,
} from '../helpers/project-fixture.mjs'

const dictionaries = () => ({
  en: {
    account: {profile: {email: 'Email', name: 'Name'}},
    home: {keep: 'Keep', legacy: 'Legacy'},
  },
  uk: {
    account: {profile: {email: 'Пошта', name: 'Ім’я'}},
    home: {keep: 'Залишити', legacy: 'Застаріле'},
  },
})

const previewAndWrite = async (testContext, arguments_) => {
  const previewProject = await createProject(testContext, {dictionaries: dictionaries()})
  const writeProject = await createProject(testContext, {dictionaries: dictionaries()})
  const previewBefore = await Promise.all([
    readBytes(previewProject.file('en')),
    readBytes(previewProject.file('uk')),
  ])

  const previewResult = await runCli(previewProject, [...arguments_, '--dry-run', '--json'])
  const writeResult = await runCli(writeProject, [...arguments_, '--write', '--json'])
  assert.equal(previewResult.exitCode, 0, previewResult.stderr)
  assert.equal(writeResult.exitCode, 0, writeResult.stderr)
  const preview = parseJsonOutput(previewResult)
  const written = parseJsonOutput(writeResult)
  assert.deepEqual(written.changes, preview.changes)
  assert.deepEqual(written.conflicts, preview.conflicts)
  assert.deepEqual(await readBytes(previewProject.file('en')), previewBefore[0])
  assert.deepEqual(await readBytes(previewProject.file('uk')), previewBefore[1])
  return {project: writeProject, report: written}
}

test('label rename exposes the same dry-run and write plan', async testContext => {
  const {project, report} = await previewAndWrite(testContext, [
    'label:rename', 'account.profile.name', 'account.profile.heading',
  ])

  assert.equal(report.operation, 'rename')
  assert.deepEqual(report.matchedKeys, ['account.profile.name'])
  assert.equal(report.changes.length, 2)
  assert.deepEqual((await readJson(project.file('en'))).account.profile, {
    email: 'Email',
    heading: 'Name',
  })
  assert.deepEqual((await readJson(project.file('uk'))).account.profile, {
    email: 'Пошта',
    heading: 'Ім’я',
  })
})

test('label move relocates a complete branch atomically', async testContext => {
  const {project, report} = await previewAndWrite(testContext, [
    'label:move', 'account.profile', 'user.profile',
  ])

  assert.equal(report.operation, 'move')
  assert.deepEqual(report.matchedKeys, ['account.profile.email', 'account.profile.name'])
  assert.equal(report.changes.length, 4)
  const en = await readJson(project.file('en'))
  assert.equal(Object.hasOwn(en, 'account'), false)
  assert.deepEqual(en.user.profile, {email: 'Email', name: 'Name'})
})

test('label delete removes the selected key and preserves siblings', async testContext => {
  const {project, report} = await previewAndWrite(testContext, [
    'label:delete', 'home.legacy',
  ])

  assert.equal(report.operation, 'delete')
  assert.equal(report.changes.length, 2)
  assert.deepEqual((await readJson(project.file('en'))).home, {keep: 'Keep'})
  assert.deepEqual((await readJson(project.file('uk'))).home, {keep: 'Залишити'})
})

test('rename collision reports conflicts and writes nothing', async testContext => {
  const project = await createProject(testContext, {
    dictionaries: {
      en: {old: {key: 'Old'}, target: {key: 'Target'}},
      uk: {old: {key: 'Старе'}, target: {key: 'Ціль'}},
    },
  })
  const enBefore = await readBytes(project.file('en'))
  const ukBefore = await readBytes(project.file('uk'))

  const result = await runCli(project, [
    'label:rename', 'old.key', 'target.key', '--write', '--json',
  ])

  assert.equal(result.exitCode, 1)
  const report = parseJsonOutput(result)
  assert.equal(report.conflicts.length, 2)
  assert.equal(report.conflicts.every(conflict => conflict.reason === 'target_exists'), true)
  assert.deepEqual(report.written, [])
  assert.deepEqual(await readBytes(project.file('en')), enBefore)
  assert.deepEqual(await readBytes(project.file('uk')), ukBefore)
})

test('non-interactive mutation requires an explicit mode', async testContext => {
  const project = await createProject(testContext, {dictionaries: dictionaries()})
  const enBefore = await readBytes(project.file('en'))
  const ukBefore = await readBytes(project.file('uk'))

  const result = await runCli(project, ['label:delete', 'home.legacy', '--json'])

  assert.equal(result.exitCode, 2)
  assert.match(parseJsonOutput(result).error.message, /Non-interactive mutation/)
  assert.deepEqual(await readBytes(project.file('en')), enBefore)
  assert.deepEqual(await readBytes(project.file('uk')), ukBefore)
})

test('language filter mutates only the selected dictionary', async testContext => {
  const project = await createProject(testContext, {dictionaries: dictionaries()})
  const enBefore = await readBytes(project.file('en'))

  const result = await runCli(project, [
    'label:delete', 'home.legacy', '--language', 'uk', '--write', '--json',
  ])

  assert.equal(result.exitCode, 0, result.stderr)
  const report = parseJsonOutput(result)
  assert.deepEqual(report.languages, ['uk'])
  assert.equal(report.changes.length, 1)
  assert.deepEqual(await readBytes(project.file('en')), enBefore)
  assert.deepEqual((await readJson(project.file('uk'))).home, {keep: 'Залишити'})
})
