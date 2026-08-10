import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {test} from 'node:test'

import {
  inspectPresetProject,
  installPreset,
} from '../../dist/shared/preset-project.service.js'
import {
  createTemporaryProject,
  pathExists,
  readBytes,
  readJson,
  writeText,
} from '../helpers/project-fixture.mjs'

const packageFile = project => path.join(project.root, 'package.json')
const runFile = (project, id) => path.join(project.root, '.run', `tl_${id}.run.xml`)
const inspect = (project, commands, dependencies) => inspectPresetProject({
  commands,
  projectRoot: project.root,
  provider: 'jetbrains',
}, dependencies)

test('install creates selected XML and adds the ctv script', async testContext => {
  const project = await createTemporaryProject(testContext)
  await writeText(packageFile(project), '{\n  "name": "fixture"\n}\n')

  const inspection = await inspect(project, ['add', 'suggest'])
  assert.deepEqual(inspection.conflicts, [])
  assert.deepEqual(await installPreset(inspection, {overwrite: true}), {
    created: ['.run/tl_add.run.xml', '.run/tl_suggest.run.xml'],
    overwritten: [],
    preserved: [],
    script: 'added',
  })
  assert.equal((await readJson(packageFile(project))).scripts.ctv, 'ctv')
  assert.equal(pathExists(runFile(project, 'add')), true)
  assert.equal(pathExists(runFile(project, 'suggest')), true)
})

test('install preserves an existing ctv script and package bytes', async testContext => {
  const project = await createTemporaryProject(testContext)
  await writeText(packageFile(project), '{"scripts":{"ctv":"ctv"}}')
  const before = await readBytes(packageFile(project))

  const report = await installPreset(await inspect(project, ['doctor']), {overwrite: true})

  assert.equal(report.script, 'preserved')
  assert.deepEqual(await readBytes(packageFile(project)), before)
})

test('inspection rejects invalid package structures without writes', async testContext => {
  const cases = [
    ['different script', '{"scripts":{"ctv":"other"}}', /already has a different value/],
    ['malformed JSON', '{invalid', /not valid JSON/],
    ['array root', '[]', /root must be an object/],
    ['null root', 'null', /root must be an object/],
    ['array scripts', '{"scripts":[]}', /scripts must be an object/],
    ['null scripts', '{"scripts":null}', /scripts must be an object/],
  ]

  for (const [name, contents, pattern] of cases) {
    await testContext.test(name, async childContext => {
      const project = await createTemporaryProject(childContext)
      await writeText(packageFile(project), contents)
      await assert.rejects(inspect(project, ['add']), pattern)
      assert.equal(pathExists(path.join(project.root, '.run')), false)
    })
  }

  const missing = await createTemporaryProject(testContext)
  await assert.rejects(inspect(missing, ['add']), /package\.json does not exist/)
  assert.equal(pathExists(path.join(missing.root, '.run')), false)
})

test('one overwrite decision applies to every existing selected target', async testContext => {
  const overwriteProject = await createTemporaryProject(testContext)
  await writeText(packageFile(overwriteProject), '{"scripts":{"ctv":"ctv"}}')
  await writeText(runFile(overwriteProject, 'add'), 'old add')
  await writeText(runFile(overwriteProject, 'get'), 'old get')
  const overwriteInspection = await inspect(overwriteProject, ['add', 'get'])
  assert.deepEqual(overwriteInspection.conflicts, [
    '.run/tl_add.run.xml', '.run/tl_get.run.xml',
  ])
  const overwritten = await installPreset(overwriteInspection, {overwrite: true})
  assert.deepEqual(overwritten.overwritten, overwriteInspection.conflicts)
  assert.notEqual((await readBytes(runFile(overwriteProject, 'add'))).toString(), 'old add')

  const preserveProject = await createTemporaryProject(testContext)
  await writeText(packageFile(preserveProject), '{"scripts":{"ctv":"ctv"}}')
  await writeText(runFile(preserveProject, 'add'), 'keep add')
  await writeText(runFile(preserveProject, 'get'), 'keep get')
  const preserved = await installPreset(
    await inspect(preserveProject, ['add', 'get', 'status']),
    {overwrite: false},
  )
  assert.deepEqual(preserved.preserved, ['.run/tl_add.run.xml', '.run/tl_get.run.xml'])
  assert.deepEqual(preserved.created, ['.run/tl_status.run.xml'])
  assert.equal((await readBytes(runFile(preserveProject, 'add'))).toString(), 'keep add')
})

test('package serialization preserves indentation, EOL, and final newline', async testContext => {
  const cases = [
    ['minified', '{"name":"fixture"}', '{"name":"fixture","scripts":{"ctv":"ctv"}}'],
    ['tabs', '{\n\t"name": "fixture"\n}\n', '{\n\t"name": "fixture",\n\t"scripts": {\n\t\t"ctv": "ctv"\n\t}\n}\n'],
    ['crlf', '{\r\n  "name": "fixture"\r\n}\r\n', '{\r\n  "name": "fixture",\r\n  "scripts": {\r\n    "ctv": "ctv"\r\n  }\r\n}\r\n'],
  ]
  for (const [name, original, expected] of cases) {
    await testContext.test(name, async childContext => {
      const project = await createTemporaryProject(childContext)
      await writeText(packageFile(project), original)
      await installPreset(await inspect(project, ['status']), {overwrite: true})
      assert.equal((await readBytes(packageFile(project))).toString(), expected)
    })
  }
})

test('inspection rejects incompatible run paths without package changes', async testContext => {
  const runBlocker = await createTemporaryProject(testContext)
  await writeText(packageFile(runBlocker), '{}')
  await writeText(path.join(runBlocker.root, '.run'), 'file')
  const runPackageBefore = await readBytes(packageFile(runBlocker))
  await assert.rejects(inspect(runBlocker, ['add']), /\.run.*not a directory/)
  assert.deepEqual(await readBytes(packageFile(runBlocker)), runPackageBefore)

  const targetBlocker = await createTemporaryProject(testContext)
  await writeText(packageFile(targetBlocker), '{}')
  await fs.promises.mkdir(runFile(targetBlocker, 'add'), {recursive: true})
  const targetPackageBefore = await readBytes(packageFile(targetBlocker))
  await assert.rejects(inspect(targetBlocker, ['add']), /target.*not a file/)
  assert.deepEqual(await readBytes(packageFile(targetBlocker)), targetPackageBefore)
})

test('inspection rejects invalid selections and missing assets', async testContext => {
  const project = await createTemporaryProject(testContext)
  await writeText(packageFile(project), '{}')
  await assert.rejects(inspect(project, []), /at least one command/)
  await assert.rejects(inspect(project, ['add', 'add']), /duplicate preset commands/)
  await assert.rejects(inspectPresetProject({
    commands: ['add'], projectRoot: project.root, provider: 'unknown',
  }), /Unknown preset provider/)
  await assert.rejects(inspect(project, ['unknown']), /Unknown preset command/)

  const enoent = Object.assign(new Error('missing'), {code: 'ENOENT'})
  await assert.rejects(inspect(project, ['add'], {
    async readFile(file) {
      if (file.endsWith('.run.xml')) throw enoent
      return fs.promises.readFile(file)
    },
  }), /Preset asset is missing:/)
  assert.equal(pathExists(path.join(project.root, '.run')), false)
})

test('installation rejects stale package and target preconditions', async testContext => {
  const packageProject = await createTemporaryProject(testContext)
  await writeText(packageFile(packageProject), '{}')
  const packageInspection = await inspect(packageProject, ['add'])
  await writeText(packageFile(packageProject), '{"changed":true}')
  await assert.rejects(installPreset(packageInspection, {overwrite: true}), /changed after sync planning/)
  assert.equal(pathExists(runFile(packageProject, 'add')), false)

  const targetProject = await createTemporaryProject(testContext)
  await writeText(packageFile(targetProject), '{"scripts":{"ctv":"ctv"}}')
  await writeText(runFile(targetProject, 'add'), 'old')
  const targetInspection = await inspect(targetProject, ['add', 'status'])
  await writeText(runFile(targetProject, 'add'), 'changed')
  await assert.rejects(installPreset(targetInspection, {overwrite: true}), /changed after sync planning/)
  assert.equal(pathExists(runFile(targetProject, 'status')), false)
})
