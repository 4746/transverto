import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import {test} from 'node:test'

import {applyFileTransaction} from '../../dist/shared/atomic-file.js'
import {SyncExecutor} from '../../dist/shared/sync-executor.js'
import {SyncPlanner} from '../../dist/shared/sync-planner.js'
import {SyncRepository} from '../../dist/shared/sync.repository.js'
import {
  createConfig,
  createProject,
  parseJsonOutput,
  pathExists,
  readBytes,
  readJson,
  runCli,
  writeText,
} from '../helpers/project-fixture.mjs'

const dictionaries = () => ({
  de: {
    extraRoot: 'Extra',
    home: {
      subtitle: 'Willkommen',
      title: 'Hallo {name}',
    },
  },
  en: {
    emptySource: '',
    home: {
      filtered: 'Filter',
      subtitle: 'Welcome',
      title: 'Hello {name}',
    },
    numeric: '123',
    token: '{{name}}',
    url: 'https://example.com',
  },
  uk: {
    extraRoot: 'Зайве',
    home: {
      extra: 'Зайве',
      title: 'Привіт {name}',
    },
  },
})

test('dry-run and write expose the same plan and write missing values atomically', async testContext => {
  const previewProject = await createProject(testContext, {dictionaries: dictionaries()})
  const writeProject = await createProject(testContext, {dictionaries: dictionaries()})
  const previewBefore = await readBytes(previewProject.file('uk'))

  const previewResult = await runCli(previewProject, ['label:sync', '--dry-run', '--json'])
  const writeResult = await runCli(writeProject, ['label:sync', '--write', '--json'])
  assert.equal(previewResult.exitCode, 0)
  assert.equal(writeResult.exitCode, 0)

  const preview = parseJsonOutput(previewResult)
  const written = parseJsonOutput(writeResult)
  assert.deepEqual(written.actions, preview.actions)
  assert.equal(preview.actions.length, 17)
  assert.deepEqual(await readBytes(previewProject.file('uk')), previewBefore)

  const uk = await readJson(writeProject.file('uk'))
  const de = await readJson(writeProject.file('de'))
  assert.equal(uk.home.subtitle, '')
  assert.equal(de.home.filtered, '')
  assert.equal(uk.extraRoot, 'Зайве')
  assert.equal(de.extraRoot, 'Extra')
  assert.equal(pathExists(writeProject.typesFile), true)
  assert.equal(written.written.filter(file => file === writeProject.typesFile).length, 1)
})

test('source, repeated targets, filters, and extra policies preserve unselected data', async testContext => {
  const project = await createProject(testContext, {dictionaries: dictionaries()})

  const sourceResult = await runCli(project, [
    'label:sync',
    '--source', 'uk',
    '--to', 'en',
    '--dry-run',
    '--json',
  ])
  assert.equal(sourceResult.exitCode, 0)
  const sourceReport = parseJsonOutput(sourceResult)
  assert.equal(sourceReport.source, 'uk')
  assert.deepEqual(sourceReport.targets, ['en'])

  const orderedResult = await runCli(project, [
    'label:sync',
    '--to', 'de',
    '--to', 'uk',
    '--dry-run',
    '--json',
  ])
  assert.equal(orderedResult.exitCode, 0)
  assert.deepEqual(parseJsonOutput(orderedResult).targets, ['uk', 'de'])

  const filteredResult = await runCli(project, [
    'label:sync',
    '--to', 'uk',
    '--include', 'home.*',
    '--exclude', '*.title',
    '--dry-run',
    '--json',
  ])
  assert.equal(filteredResult.exitCode, 0)
  const filtered = parseJsonOutput(filteredResult)
  assert.equal(filtered.actions.length, 3)
  assert.equal(filtered.actions.every(action => action.language === 'uk'), true)
  assert.equal(
    filtered.actions.every(action => action.key.startsWith('home.') && !action.key.endsWith('.title')),
    true,
  )

  const keep = parseJsonOutput(await runCli(project, [
    'label:sync', '--extra', 'keep', '--dry-run', '--json',
  ]))
  const report = parseJsonOutput(await runCli(project, [
    'label:sync', '--extra', 'report', '--dry-run', '--json',
  ]))
  const remove = parseJsonOutput(await runCli(project, [
    'label:sync', '--extra', 'remove', '--dry-run', '--json',
  ]))
  assert.equal(keep.actions.filter(action => action.reason === 'extra_kept').length, 3)
  assert.equal(report.actions.filter(action => action.reason === 'extra_reported').length, 3)
  assert.equal(
    remove.actions.filter(action => action.reason === 'extra_removed' && action.type === 'remove').length,
    3,
  )

  const removalProject = await createProject(testContext, {dictionaries: dictionaries()})
  const deBefore = await readBytes(removalProject.file('de'))
  const removalResult = await runCli(removalProject, [
    'label:sync',
    '--to', 'uk',
    '--extra', 'remove',
    '--write',
    '--json',
  ])
  assert.equal(removalResult.exitCode, 0)
  assert.deepEqual(await readBytes(removalProject.file('de')), deBefore)
  const uk = await readJson(removalProject.file('uk'))
  assert.equal(Object.hasOwn(uk, 'extraRoot'), false)
  assert.equal(Object.hasOwn(uk.home, 'extra'), false)
  assert.equal(uk.home.subtitle, '')
})

test('invalid input and non-TTY mutation exit 2 before writes', async testContext => {
  const project = await createProject(testContext, {dictionaries: dictionaries()})
  const before = await readBytes(project.file('uk'))
  const nonInteractive = await runCli(project, ['label:sync', '--json'])
  assert.equal(nonInteractive.exitCode, 2)
  assert.equal(parseJsonOutput(nonInteractive).error.oclif.exit, 2)
  assert.deepEqual(await readBytes(project.file('uk')), before)
  assert.equal(pathExists(project.typesFile), false)

  const invalidProject = await createProject(testContext, {
    config: createConfig({languages: ['en', 'uk']}),
    dictionaries: {
      en: {},
      uk: {bad: 1},
    },
  })
  const invalid = await runCli(invalidProject, ['label:sync', '--dry-run', '--json'])
  assert.equal(invalid.exitCode, 2)
  assert.match(parseJsonOutput(invalid).error.message, /Translation leaf "bad" must be a string/)
  assert.equal(pathExists(invalidProject.typesFile), false)
})

test('structural conflict exits 1 and aborts every write', async testContext => {
  const project = await createProject(testContext, {
    dictionaries: {
      de: {},
      en: {menu: {item: 'Item'}},
      uk: {menu: 'Меню'},
    },
  })
  const ukBefore = await readBytes(project.file('uk'))
  const deBefore = await readBytes(project.file('de'))

  const result = await runCli(project, ['label:sync', '--write', '--json'])
  assert.equal(result.exitCode, 1)
  const report = parseJsonOutput(result)
  assert.equal(report.summary.total.conflicts, 1)
  assert.deepEqual(report.written, [])
  assert.deepEqual(await readBytes(project.file('uk')), ukBefore)
  assert.deepEqual(await readBytes(project.file('de')), deBefore)
  assert.equal(pathExists(project.typesFile), false)
})

test('stale snapshot preserves external content and creates no enum', async testContext => {
  const project = await createProject(testContext, {
    dictionaries: {
      de: {},
      en: {home: {title: 'Hello'}},
      uk: {extra: 'old'},
    },
  })
  const snapshot = await SyncRepository.load(project.config, {
    cwd: project.root,
    targets: ['uk'],
  })
  const plan = SyncPlanner.create(snapshot, {autoTranslate: false})
  const external = `${JSON.stringify({external: 'change'}, null, 2)}\n`
  await writeText(project.file('uk'), external)

  await assert.rejects(
    SyncExecutor.apply({batch: null, plan, snapshot}),
    /File changed after sync planning/,
  )
  assert.equal(await fs.promises.readFile(project.file('uk'), 'utf8'), external)
  assert.equal(pathExists(project.typesFile), false)
})

test('auto-translate dry-run uses batch limits and performs no network or writes', async testContext => {
  let connections = 0
  const server = net.createServer(socket => {
    connections += 1
    socket.destroy()
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  testContext.after(async () => new Promise(resolve => {
    server.close(resolve)
  }))
  const address = server.address()
  assert.notEqual(address, null)
  assert.equal(typeof address, 'object')

  const project = await createProject(testContext, {
    config: createConfig({
      batch: {maxItems: 1},
      engine: 'sentinel',
      engines: {
        sentinel: {
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          model: 'fixture-model',
          provider: 'openai-compatible',
          timeoutMs: 100,
        },
      },
    }),
    dictionaries: {
      de: {},
      en: {
        emptySource: '',
        first: 'First',
        second: 'Second',
        url: 'https://example.com',
      },
      uk: {},
    },
  })
  const ukBefore = await readBytes(project.file('uk'))
  const deBefore = await readBytes(project.file('de'))

  const result = await runCli(project, [
    'label:sync',
    '--auto-translate',
    '--dry-run',
    '--json',
  ])
  assert.equal(result.exitCode, 1)
  const report = parseJsonOutput(result)
  assert.equal(connections, 0)
  assert.equal(report.batch.remaining.filter(item => item.reason === 'dry_run').length, 1)
  assert.equal(report.batch.remaining.filter(item => item.reason === 'limit').length, 3)
  assert.equal(report.summary.total.skipped, 4)
  assert.deepEqual(await readBytes(project.file('uk')), ukBefore)
  assert.deepEqual(await readBytes(project.file('de')), deBefore)
  assert.equal(pathExists(project.typesFile), false)
})

test('file transaction restores an earlier mutation when a later write fails', async testContext => {
  const project = await createProject(testContext)
  const first = path.join(project.root, 'first.txt')
  const blocker = path.join(project.root, 'blocker')
  await writeText(first, 'old')
  await writeText(blocker, 'not-a-directory')

  await assert.rejects(applyFileTransaction([
    {content: 'new', file: first},
    {content: 'second', file: path.join(blocker, 'child.txt')},
  ]))
  assert.equal(await fs.promises.readFile(first, 'utf8'), 'old')
})
