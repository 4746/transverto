import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {test} from 'node:test'

import {
  createProject,
  parseJsonOutput,
  pathExists,
  readBytes,
  readJson,
  runCli,
  writeText,
} from '../helpers/project-fixture.mjs'

test('export csv is deterministic and escapes special values', async testContext => {
  const project = await createProject(testContext, {
    dictionaries: {
      en: {
        alpha: 'A, B',
        multiline: 'line 1\nline 2',
        quote: 'Say "Hi"',
      },
      uk: {
        alpha: 'А, Б',
        multiline: 'рядок 1\nрядок 2',
        quote: 'Сказати "Привіт"',
      },
    },
  })
  const output = path.join(project.root, 'translations.csv')
  const arguments_ = [
    'export:csv', 'en', '--include', 'uk', '--outputFile', 'translations.csv', '--eol', 'lf',
  ]

  const first = await runCli(project, arguments_)
  assert.equal(first.exitCode, 0, first.stderr)
  const firstBytes = await readBytes(output)
  const contents = firstBytes.toString('utf8')
  assert.match(contents, /^"label","en","en_new","uk","uk_new"\n/)
  assert.ok(contents.indexOf('"alpha"') < contents.indexOf('"multiline"'))
  assert.ok(contents.indexOf('"multiline"') < contents.indexOf('"quote"'))
  assert.match(contents, /"A, B"/)
  assert.match(contents, /"Say ""Hi"""/)
  assert.match(contents, /"line 1\nline 2"/)

  const second = await runCli(project, arguments_)
  assert.equal(second.exitCode, 0, second.stderr)
  assert.deepEqual(await readBytes(output), firstBytes)
})

test('export csv rejects an unconfigured language without creating output', async testContext => {
  const project = await createProject(testContext)
  const output = path.join(project.root, 'invalid.csv')

  const result = await runCli(project, [
    'export:csv', 'fr', '--outputFile', 'invalid.csv',
  ])

  assert.equal(result.exitCode, 2)
  assert.match(result.stderr, /Language "fr" is not configured/)
  assert.equal(pathExists(output), false)
})

const importDictionaries = {
  en: {home: {subtitle: 'Welcome', title: 'Hello'}},
  uk: {home: {subtitle: 'Ласкаво просимо', title: 'Привіт'}},
}

test('import csv preview and write expose the same plan', async testContext => {
  const previewProject = await createProject(testContext, {dictionaries: importDictionaries})
  const writeProject = await createProject(testContext, {dictionaries: importDictionaries})
  const csv = [
    '"label","en_new","uk_new"',
    '"home.subtitle","","Новий підзаголовок"',
    '"home.title","Hello updated","Новий заголовок"',
    '',
  ].join('\n')
  const previewFile = path.join(previewProject.root, 'translations.csv')
  const writeFile = path.join(writeProject.root, 'translations.csv')
  await writeText(previewFile, csv)
  await writeText(writeFile, csv)
  const previewBefore = await Promise.all([
    readBytes(previewProject.file('en')),
    readBytes(previewProject.file('uk')),
  ])
  const baseArguments = [
    'import:csv', 'translations.csv', '--use-new-columns', '--existing', 'overwrite', '--json',
  ]

  const previewResult = await runCli(previewProject, [...baseArguments, '--dry-run'])
  const writeResult = await runCli(writeProject, [...baseArguments, '--write'])

  assert.equal(previewResult.exitCode, 0, previewResult.stderr)
  assert.equal(writeResult.exitCode, 0, writeResult.stderr)
  const preview = parseJsonOutput(previewResult)
  const written = parseJsonOutput(writeResult)
  assert.deepEqual(written.actions, preview.actions)
  assert.equal(preview.summary.update, 3)
  assert.equal(preview.summary.skip, 1)
  assert.deepEqual(await readBytes(previewProject.file('en')), previewBefore[0])
  assert.deepEqual(await readBytes(previewProject.file('uk')), previewBefore[1])
  assert.deepEqual((await readJson(writeProject.file('en'))).home, {
    subtitle: 'Welcome',
    title: 'Hello updated',
  })
  assert.deepEqual((await readJson(writeProject.file('uk'))).home, {
    subtitle: 'Новий підзаголовок',
    title: 'Новий заголовок',
  })
  assert.ok(written.status)
  assert.ok(written.written.includes(writeProject.file('en')))
  assert.ok(written.written.includes(writeProject.file('uk')))
})

test('import csv rejects malformed input before changing dictionaries', async testContext => {
  const cases = [
    ['duplicate headers', 'label,uk_new,uk_new\nhome.title,one,two\n', /duplicate headers/],
    ['unterminated quote', 'label,uk_new\nhome.title,"broken\n', /unterminated quoted field/],
  ]

  for (const [name, csv, message] of cases) {
    await testContext.test(name, async childContext => {
      const project = await createProject(childContext, {dictionaries: importDictionaries})
      const enBefore = await readBytes(project.file('en'))
      const ukBefore = await readBytes(project.file('uk'))
      await writeText(path.join(project.root, 'invalid.csv'), csv)

      const result = await runCli(project, [
        'import:csv', 'invalid.csv', '--use-new-columns', '--write', '--json',
      ])

      assert.equal(result.exitCode, 2)
      assert.match(parseJsonOutput(result).error.message, message)
      assert.deepEqual(await readBytes(project.file('en')), enBefore)
      assert.deepEqual(await readBytes(project.file('uk')), ukBefore)
    })
  }
})

test('import csv conflict writes nothing', async testContext => {
  const project = await createProject(testContext, {dictionaries: importDictionaries})
  const enBefore = await readBytes(project.file('en'))
  const ukBefore = await readBytes(project.file('uk'))
  await fs.promises.writeFile(
    path.join(project.root, 'conflict.csv'),
    'label,uk_new\nhome.title,Інший заголовок\n',
  )

  const result = await runCli(project, [
    'import:csv', 'conflict.csv', '--use-new-columns', '--write', '--json',
  ])

  assert.equal(result.exitCode, 1)
  const report = parseJsonOutput(result)
  assert.equal(report.summary.conflict, 1)
  assert.deepEqual(report.written, [])
  assert.deepEqual(await readBytes(project.file('en')), enBefore)
  assert.deepEqual(await readBytes(project.file('uk')), ukBefore)
})
