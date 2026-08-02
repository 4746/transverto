import {spawn} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const FIXTURE_PREFIX = 'transverto-safe-sync-e2e-'
const helperDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(helperDirectory, '../../..')
const cliFile = path.join(repositoryRoot, 'bin', 'run.js')

const serialize = value => `${JSON.stringify(value, null, 2)}\n`

export const createConfig = ({
  batch = {},
  engine = null,
  engines = {},
  fallback = null,
  languages = ['en', 'uk', 'de'],
  source = 'en',
} = {}) => ({
  basePath: 'dist/i18n',
  basePathEnum: 'dist/i18n/language.ts',
  batch: {
    concurrency: 1,
    delayMs: 0,
    maxChars: null,
    maxItems: null,
    retry: 2,
    ...batch,
  },
  cache: {
    maxEntries: 1000,
    ttlMs: 2_592_000_000,
  },
  engine,
  engines,
  fallback,
  labelValidation: String.raw`^[a-z0-9\.\-\_]{3,100}$`,
  langCodeDefault: source,
  languages,
  nameEnum: 'LanguageLabel',
})

const cleanupFixture = async root => {
  const resolved = path.resolve(root)
  const temporaryRoot = `${path.resolve(os.tmpdir())}${path.sep}`
  if (!resolved.startsWith(temporaryRoot) || !path.basename(resolved).startsWith(FIXTURE_PREFIX)) {
    throw new Error(`Refusing to remove unsafe E2E fixture path: ${resolved}`)
  }

  await fs.promises.rm(resolved, {force: true, recursive: true})
}

export async function createProject(
  testContext,
  {
    config = createConfig(),
    dictionaries = {},
  } = {},
) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), FIXTURE_PREFIX))
  testContext.after(async () => cleanupFixture(root))

  const translationsDirectory = path.join(root, config.basePath)
  await fs.promises.mkdir(translationsDirectory, {recursive: true})
  await fs.promises.writeFile(path.join(root, '.ctv.config.json'), serialize(config))

  await Promise.all(config.languages.map(async language =>
    fs.promises.writeFile(
      path.join(translationsDirectory, `${language}.json`),
      serialize(dictionaries[language] ?? {}),
    ),
  ))

  return {
    config,
    file: language => path.join(translationsDirectory, `${language}.json`),
    root,
    typesFile: path.join(root, config.basePathEnum),
  }
}

export async function runCli(project, arguments_, {timeoutMs = 10_000} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliFile, ...arguments_], {
      cwd: project.root,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    let stdout = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    child.once('error', reject)
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

export const writeText = (file, contents) => fs.promises.writeFile(file, contents)
