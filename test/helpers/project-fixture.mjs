import {spawn} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

import {CTV_CONFIG_SCHEMA_URL} from '../../dist/shared/constants.js'

const FIXTURE_PREFIX = 'transverto-critical-tests-'
const helperDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(helperDirectory, '../..')
const cliFile = path.join(repositoryRoot, 'bin', 'run.js')

const serialize = value => `${JSON.stringify(value, null, 2)}\n`

export const createConfig = ({
  batch = {},
  cache = {},
  engine = null,
  engines = {},
  fallback = null,
  languages = ['en', 'uk', 'de'],
  source = 'en',
  ...overrides
} = {}) => ({
  $schema: CTV_CONFIG_SCHEMA_URL,
  basePath: 'dist/i18n',
  basePathEnum: 'dist/i18n/language.ts',
  batch: {
    concurrency: 1,
    delayMs: 0,
    maxChars: null,
    maxItems: null,
    mode: 'per-language',
    retry: 0,
    ...batch,
  },
  cache: {
    maxEntries: 1000,
    ttlMs: 2_592_000_000,
    ...cache,
  },
  engine,
  engines,
  fallback,
  labelSuggestionCount: 5,
  labelSuggestionShowInvalid: false,
  labelValidation: String.raw`^[a-z0-9\.\-\_]{3,100}$`,
  langCodeDefault: source,
  languages,
  nameEnum: 'LanguageLabel',
  ...overrides,
})

const cleanupFixture = async root => {
  const resolved = path.resolve(root)
  const temporaryRoot = `${path.resolve(os.tmpdir())}${path.sep}`
  if (!resolved.startsWith(temporaryRoot) || !path.basename(resolved).startsWith(FIXTURE_PREFIX)) {
    throw new Error(`Refusing to remove unsafe test fixture path: ${resolved}`)
  }

  await fs.promises.rm(resolved, {force: true, recursive: true})
}

export async function createTemporaryProject(testContext) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), FIXTURE_PREFIX))
  testContext.after(async () => cleanupFixture(root))

  return {
    cacheRoot: path.join(root, '.cache'),
    configFile: path.join(root, '.ctv.config.json'),
    file: language => path.join(root, 'dist', 'i18n', `${language}.json`),
    root,
    typesFile: path.join(root, 'dist', 'i18n', 'language.ts'),
  }
}

export async function createProject(
  testContext,
  {
    config = createConfig(),
    dictionaries = {},
  } = {},
) {
  const project = await createTemporaryProject(testContext)
  const translationsDirectory = path.join(project.root, config.basePath)
  await fs.promises.mkdir(translationsDirectory, {recursive: true})
  await fs.promises.writeFile(project.configFile, serialize(config))

  await Promise.all(config.languages.map(async language =>
    fs.promises.writeFile(
      path.join(translationsDirectory, `${language}.json`),
      serialize(dictionaries[language] ?? {}),
    ),
  ))

  return {
    ...project,
    config,
    file: language => path.join(translationsDirectory, `${language}.json`),
    typesFile: path.join(project.root, config.basePathEnum),
  }
}

export async function runCli(
  project,
  arguments_,
  {
    env = {},
    input = null,
    timeoutMs = 10_000,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliFile, ...arguments_], {
      cwd: project.root,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        LOCALAPPDATA: project.cacheRoot,
        NO_COLOR: '1',
        XDG_CACHE_HOME: project.cacheRoot,
        ...env,
      },
      stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })
    let stderr = ''
    let stdout = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)

    if (input !== null) child.stdin.end(input)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    child.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (exitCode, signal) => {
      clearTimeout(timer)
      if (timedOut) {
        reject(new Error(`CLI timed out after ${timeoutMs}ms. stdout=${stdout} stderr=${stderr}`))
        return
      }

      resolve({exitCode, signal, stderr, stdout})
    })
  })
}

export const parseJsonOutput = result => {
  const output = result.stdout.trim() || result.stderr.trim()
  if (!output) throw new Error('CLI produced no JSON output.')
  return JSON.parse(output)
}

export const readJson = async file =>
  JSON.parse(await fs.promises.readFile(file, 'utf8'))

export const readBytes = file => fs.promises.readFile(file)

export const pathExists = file => Boolean(fs.statSync(file, {throwIfNoEntry: false}))

export const writeText = async (file, contents) => {
  await fs.promises.mkdir(path.dirname(file), {recursive: true})
  await fs.promises.writeFile(file, contents)
}
