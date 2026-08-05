import assert from 'node:assert/strict'
import fs from 'node:fs'
import {test} from 'node:test'

import {startOpenAiServer} from '../helpers/http-server.mjs'
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

test('label:add translates one source value to all targets in one package', async testContext => {
  const server = await startOpenAiServer(testContext, () => ({
    body: {choices: [{message: {content: '{"uk":"Мова","de":"Sprache"}'}}]}, status: 200,
  }))
  const project = await createProject(testContext, {
    config: createConfig({
      batch: {mode: 'multi-language'}, engine: 'fixture', engines: {fixture: {baseUrl: server.baseUrl, model: 'fixture-model', provider: 'openai-compatible'}},
      languages: ['en', 'uk', 'de'],
    }),
  })
  const result = await runCli(project, [
    'label:add', 'label.language', '-f', 'en', '-t', 'Language', '--silent',
  ])
  assert.equal(result.exitCode, 0, result.stderr)
  assert.equal(server.requests.length, 1)
  assert.equal((await readJson(project.file('en'))).label.language, 'Language')
  assert.equal((await readJson(project.file('uk'))).label.language, 'Мова')
  assert.equal((await readJson(project.file('de'))).label.language, 'Sprache')
})

test('label:add translates from a non-default source in multi-language mode', async testContext => {
  const server = await startOpenAiServer(testContext, () => ({
    body: {choices: [{message: {content: '{"en":"Hello world!","de":"Hallo Welt!"}'}}]}, status: 200,
  }))
  const project = await createProject(testContext, {
    config: createConfig({
      batch: {mode: 'multi-language'}, engine: 'fixture',
      engines: {fixture: {baseUrl: server.baseUrl, model: 'fixture-model', provider: 'openai-compatible'}},
      languages: ['en', 'uk', 'de'],
    }),
  })

  const result = await runCli(project, [
    'label:add', 'btn.world', '--fromLangCode', 'uk', '-t', 'Привіт, світ!', '--silent',
  ])

  assert.equal(result.exitCode, 0, result.stderr)
  assert.equal(server.requests.length, 1)
  assert.equal((await readJson(project.file('uk'))).btn.world, 'Привіт, світ!')
  assert.equal((await readJson(project.file('en'))).btn.world, 'Hello world!')
  assert.equal((await readJson(project.file('de'))).btn.world, 'Hallo Welt!')
  assert.match(await fs.promises.readFile(project.typesFile, 'utf8'), /'btn\.world'/)
})

test('label:add translates from a non-default source in per-language mode', async testContext => {
  const server = await startOpenAiServer(testContext, request => {
    const prompt = request.body.messages.at(-1).content
    const content = prompt.includes('Target language: en') ? 'Hello world!' : 'Hallo Welt!'
    return {body: {choices: [{message: {content}}]}, status: 200}
  })
  const project = await createProject(testContext, {
    config: createConfig({
      batch: {mode: 'per-language'}, engine: 'fixture',
      engines: {fixture: {baseUrl: server.baseUrl, model: 'fixture-model', provider: 'openai-compatible'}},
      languages: ['en', 'uk', 'de'],
    }),
  })

  const result = await runCli(project, [
    'label:add', 'btn.world', '--fromLangCode', 'uk', '-t', 'Привіт, світ!', '--silent',
  ])

  assert.equal(result.exitCode, 0, result.stderr)
  assert.equal(server.requests.length, 2)
  assert.equal((await readJson(project.file('uk'))).btn.world, 'Привіт, світ!')
  assert.equal((await readJson(project.file('en'))).btn.world, 'Hello world!')
  assert.equal((await readJson(project.file('de'))).btn.world, 'Hallo Welt!')
  assert.match(await fs.promises.readFile(project.typesFile, 'utf8'), /'btn\.world'/)
})

test('label:add rejects an existing key non-interactively without side effects', async testContext => {
  const project = await createProject(testContext, {dictionaries: dictionaries()})
  await writeText(project.typesFile, 'original types\n')
  const before = await Promise.all(['en', 'uk'].map(language => readBytes(project.file(language))))
  const typesBefore = await readBytes(project.typesFile)

  const result = await runCli(project, [
    'label:add', 'home.keep', '--fromLangCode', 'uk',
    '--translation', 'Нове значення', '--noAutoTranslate', '--silent',
  ])

  assert.equal(result.exitCode, 2)
  assert.match(result.stderr, /Translation key "home\.keep" already exists/)
  assert.deepEqual(await readBytes(project.file('en')), before[0])
  assert.deepEqual(await readBytes(project.file('uk')), before[1])
  assert.deepEqual(await readBytes(project.typesFile), typesBefore)
})

test('label:add detects an existing key outside fromLangCode', async testContext => {
  const project = await createProject(testContext, {
    dictionaries: {de: {}, en: {title: {data: 'Data'}}, uk: {}},
  })
  const before = await Promise.all(['en', 'uk', 'de'].map(language => readBytes(project.file(language))))

  const result = await runCli(project, [
    'label:add', 'title.data', '--fromLangCode', 'uk',
    '--translation', 'Дані', '--noAutoTranslate', '--silent',
  ])

  assert.equal(result.exitCode, 2)
  assert.match(result.stderr, /Translation key "title\.data" already exists/)
  for (const [index, language] of ['en', 'uk', 'de'].entries()) {
    assert.deepEqual(await readBytes(project.file(language)), before[index])
  }
})

test('label:add incomplete package rolls back source, targets, and types', async testContext => {
  const server = await startOpenAiServer(testContext, () => ({
    body: {choices: [{message: {content: '{"uk":"Мова"}'}}]}, status: 200,
  }))
  const project = await createProject(testContext, {
    config: createConfig({
      batch: {mode: 'multi-language'}, engine: 'fixture',
      engines: {fixture: {baseUrl: server.baseUrl, model: 'fixture-model', provider: 'openai-compatible'}},
      languages: ['en', 'uk', 'de'],
    }),
  })
  await writeText(project.typesFile, 'original types\n')
  const before = await Promise.all(['en', 'uk', 'de'].map(language => readBytes(project.file(language))))
  const typesBefore = await readBytes(project.typesFile)
  const result = await runCli(project, [
    'label:add', 'label.language', '-f', 'en', '-t', 'Language', '--silent',
  ])
  assert.equal(result.exitCode, 1, result.stderr)
  assert.equal(server.requests.length, 1)
  for (const [index, language] of ['en', 'uk', 'de'].entries()) {
    assert.deepEqual(await readBytes(project.file(language)), before[index])
  }

  assert.deepEqual(await readBytes(project.typesFile), typesBefore)
})

test('label:add placeholder conflict rolls back every project artifact', async testContext => {
  const server = await startOpenAiServer(testContext, () => ({
    body: {choices: [{message: {content: '{"uk":"Привіт","de":"Hallo {name}"}'}}]}, status: 200,
  }))
  const project = await createProject(testContext, {
    config: createConfig({
      batch: {mode: 'multi-language'}, engine: 'fixture',
      engines: {fixture: {baseUrl: server.baseUrl, model: 'fixture-model', provider: 'openai-compatible'}},
      languages: ['en', 'uk', 'de'],
    }),
  })
  await writeText(project.typesFile, 'original types\n')
  const before = await Promise.all(['en', 'uk', 'de'].map(language => readBytes(project.file(language))))
  const typesBefore = await readBytes(project.typesFile)

  const result = await runCli(project, [
    'label:add', 'label.greeting', '-f', 'en', '-t', 'Hello {name}', '--silent',
  ])

  assert.equal(result.exitCode, 1, result.stderr)
  for (const [index, language] of ['en', 'uk', 'de'].entries()) {
    assert.deepEqual(await readBytes(project.file(language)), before[index])
  }

  assert.deepEqual(await readBytes(project.typesFile), typesBefore)
})

test('label:add per-language failure rolls back every project artifact', async testContext => {
  const server = await startOpenAiServer(testContext, request => {
    const prompt = request.body.messages.at(-1).content
    return prompt.includes('Target language: de')
      ? {body: {error: {message: 'down'}}, status: 500}
      : {body: {choices: [{message: {content: 'Hello world!'}}]}, status: 200}
  })
  const project = await createProject(testContext, {
    config: createConfig({
      batch: {mode: 'per-language'}, engine: 'fixture',
      engines: {fixture: {baseUrl: server.baseUrl, model: 'fixture-model', provider: 'openai-compatible'}},
      languages: ['en', 'uk', 'de'],
    }),
  })
  await writeText(project.typesFile, 'original types\n')
  const before = await Promise.all(['en', 'uk', 'de'].map(language => readBytes(project.file(language))))
  const typesBefore = await readBytes(project.typesFile)

  const result = await runCli(project, [
    'label:add', 'btn.world', '--fromLangCode', 'uk', '-t', 'Привіт, світ!', '--silent',
  ])

  assert.equal(result.exitCode, 1, result.stderr)
  for (const [index, language] of ['en', 'uk', 'de'].entries()) {
    assert.deepEqual(await readBytes(project.file(language)), before[index])
  }

  assert.deepEqual(await readBytes(project.typesFile), typesBefore)
})

test('label:add reports every translation engine failure', async testContext => {
  const server = await startOpenAiServer(testContext, request => {
    const prompt = request.body.messages.at(-1).content
    const target = prompt.includes('Target language: en') ? 'en' : 'de'
    return {body: {error: {message: `${target} provider down`}}, status: 500}
  })
  const project = await createProject(testContext, {
    config: createConfig({
      batch: {mode: 'per-language', retry: 1}, engine: 'fixture',
      engines: {fixture: {baseUrl: server.baseUrl, model: 'fixture-model', provider: 'openai-compatible'}},
      languages: ['en', 'uk', 'de'],
    }),
  })
  await writeText(project.typesFile, 'original types\n')
  const before = await Promise.all(['en', 'uk', 'de'].map(language => readBytes(project.file(language))))
  const typesBefore = await readBytes(project.typesFile)

  const result = await runCli(project, [
    'label:add', 'btn.world', '--fromLangCode', 'uk', '-t', 'Привіт, світ!', '--silent',
  ])

  assert.equal(result.exitCode, 1)
  assert.match(result.stderr, /Translation failed; label was not added:/)
  assert.match(result.stderr, /- en \[provider_unavailable\] after 2 attempts: .*en provider down/)
  assert.match(result.stderr, /- de \[provider_unavailable\] after 2 attempts: .*de provider down/)
  assert.doesNotMatch(result.stderr, /^Translation batch contains failed items and is not complete\.$/m)
  assert.equal(server.requests.length, 4)

  for (const [index, language] of ['en', 'uk', 'de'].entries()) {
    assert.deepEqual(await readBytes(project.file(language)), before[index])
  }

  assert.deepEqual(await readBytes(project.typesFile), typesBefore)
})

test('label:add rejects a missing configured dictionary without creating artifacts', async testContext => {
  const project = await createProject(testContext)
  await fs.promises.rm(project.file('de'))
  const enBefore = await readBytes(project.file('en'))
  const ukBefore = await readBytes(project.file('uk'))

  const result = await runCli(project, [
    'label:add', 'btn.world', '--fromLangCode', 'uk', '-t', 'Привіт, світ!', '--noAutoTranslate', '--silent',
  ])

  assert.equal(result.exitCode, 2)
  assert.deepEqual(await readBytes(project.file('en')), enBefore)
  assert.deepEqual(await readBytes(project.file('uk')), ukBefore)
  assert.equal(pathExists(project.file('de')), false)
  assert.equal(pathExists(project.typesFile), false)
})

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
