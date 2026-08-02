import {createHash} from 'node:crypto'
import fs from 'node:fs'

import {writeFileAtomic} from './atomic-file.js'
import {
  ITranslationCacheConfig,
  ITranslationCacheEntry,
  ITranslationCacheFile,
  ITranslationCacheFilters,
  ITranslationCacheIdentity,
  ITranslationCacheListResult,
  ITranslationCachePruneResult,
  ITranslationCacheSummary,
} from './entities/translation-cache.js'

const EMPTY_CACHE: ITranslationCacheFile = {entries: [], version: 1}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))

const normalizeText = (value: string): string => value.normalize('NFC')

const cacheId = (identity: ITranslationCacheIdentity): string => createHash('sha256')
  .update(JSON.stringify([
    identity.profile,
    identity.model,
    identity.from,
    identity.to,
    normalizeText(identity.sourceText),
  ]))
  .digest('hex')

const matchesFilters = (
  entry: ITranslationCacheEntry,
  filters: ITranslationCacheFilters,
): boolean => (
  (filters.profile === undefined || entry.profile === filters.profile) &&
  (filters.model === undefined || entry.model === filters.model) &&
  (filters.from === undefined || entry.from === filters.from) &&
  (filters.to === undefined || entry.to === filters.to)
)

const parseEntry = (value: unknown, index: number): ITranslationCacheEntry => {
  if (!isObject(value)) throw new Error(`Entry ${index} must be an object.`)

  const requiredStrings = ['id', 'profile', 'model', 'from', 'to', 'sourceText', 'translatedText'] as const
  for (const field of requiredStrings) {
    if (typeof value[field] !== 'string') throw new Error(`Entry ${index} field "${field}" must be a string.`)
  }

  if (!isTimestamp(value.createdAt) || !isTimestamp(value.accessedAt)) {
    throw new Error(`Entry ${index} contains an invalid timestamp.`)
  }

  const entry = value as unknown as ITranslationCacheEntry
  if (entry.id !== cacheId(entry)) throw new Error(`Entry ${index} has an invalid cache key.`)
  return entry
}

const summarize = (entries: ITranslationCacheEntry[]): ITranslationCacheSummary => {
  const profileCounts = new Map<string, {count: number; model: string; profile: string}>()
  for (const entry of entries) {
    const key = JSON.stringify([entry.profile, entry.model])
    const item = profileCounts.get(key) ?? {count: 0, model: entry.model, profile: entry.profile}
    item.count += 1
    profileCounts.set(key, item)
  }

  const created = entries.map(({createdAt}) => createdAt).sort()
  return {
    count: entries.length,
    oldestCreatedAt: created[0] ?? null,
    profiles: [...profileCounts.values()].sort((left, right) =>
      left.profile.localeCompare(right.profile) || left.model.localeCompare(right.model)),
  }
}

export function validateTranslationCacheConfig(value: unknown): ITranslationCacheConfig {
  if (!isObject(value)) throw new Error('Configuration field "cache" must be an object.')

  const {maxEntries, ttlMs} = value
  if (!Number.isSafeInteger(maxEntries) || (maxEntries as number) < 1) {
    throw new Error('Configuration field "cache.maxEntries" must be a positive integer.')
  }

  if (ttlMs !== null && (!Number.isSafeInteger(ttlMs) || (ttlMs as number) < 1)) {
    throw new Error('Configuration field "cache.ttlMs" must be a positive integer or null.')
  }

  return {maxEntries: maxEntries as number, ttlMs: ttlMs as null | number}
}

export class TranslationCacheService {
  private mutationQueue: Promise<void> = Promise.resolve()
  constructor(
    private readonly file: string,
    private readonly config: ITranslationCacheConfig,
    private readonly now: () => Date = () => new Date(),
  ) {
    validateTranslationCacheConfig(config)
  }

  async clear(filters: ITranslationCacheFilters = {}): Promise<number> {
    return this.runExclusive(async () => {
      const cache = await this.read()
      const retained = cache.entries.filter(entry => !matchesFilters(entry, filters))
      const removed = cache.entries.length - retained.length
      if (removed > 0) await this.write({...cache, entries: retained})
      return removed
    })
  }

  async get(identity: ITranslationCacheIdentity): Promise<ITranslationCacheEntry | undefined> {
    return this.runExclusive(async () => {
      const cache = await this.read()
      const id = cacheId({...identity, sourceText: normalizeText(identity.sourceText)})
      const entry = cache.entries.find(candidate => candidate.id === id)
      if (!entry) return

      if (this.isExpired(entry)) {
        await this.write({...cache, entries: cache.entries.filter(candidate => candidate.id !== id)})
        return
      }

      entry.accessedAt = this.now().toISOString()
      await this.write(cache)
      return {...entry}
    })
  }

  async list(filters: ITranslationCacheFilters = {}): Promise<ITranslationCacheListResult> {
    const cache = await this.read()
    const entries = cache.entries
      .filter(entry => matchesFilters(entry, filters))
      .sort((left, right) => left.profile.localeCompare(right.profile) ||
        left.model.localeCompare(right.model) || left.from.localeCompare(right.from) ||
        left.to.localeCompare(right.to) || left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id))

    return {entries, filters: {...filters}, summary: summarize(entries)}
  }

  async prune(): Promise<ITranslationCachePruneResult> {
    return this.runExclusive(async () => this.pruneUnlocked())
  }

  async set(identity: ITranslationCacheIdentity, translatedText: string): Promise<void> {
    return this.runExclusive(async () => {
      const cache = await this.read()
      const sourceText = normalizeText(identity.sourceText)
      const normalizedIdentity = {...identity, sourceText}
      const id = cacheId(normalizedIdentity)
      const timestamp = this.now().toISOString()
      const previous = cache.entries.find(entry => entry.id === id)
      const entry: ITranslationCacheEntry = {
        ...normalizedIdentity,
        accessedAt: timestamp,
        createdAt: previous?.createdAt ?? timestamp,
        id,
        translatedText,
      }

      const entries = cache.entries.filter(candidate => candidate.id !== id)
      entries.push(entry)
      await this.write({...cache, entries})
      await this.pruneUnlocked()
    })
  }

  private isExpired(entry: ITranslationCacheEntry): boolean {
    return this.config.ttlMs !== null &&
      this.now().getTime() - Date.parse(entry.createdAt) >= this.config.ttlMs
  }

  private async pruneUnlocked(): Promise<ITranslationCachePruneResult> {
    const cache = await this.read()
    const active = cache.entries.filter(entry => !this.isExpired(entry))
    const expired = cache.entries.length - active.length
    const retained = active
      .sort((left, right) => right.accessedAt.localeCompare(left.accessedAt) || right.id.localeCompare(left.id))
      .slice(0, this.config.maxEntries)
    const removedByLimit = active.length - retained.length
    const removed = expired + removedByLimit
    if (removed > 0) await this.write({...cache, entries: retained})

    return {expired, remaining: retained.length, removed, removedByLimit}
  }

  private async read(): Promise<ITranslationCacheFile> {
    let contents: string
    try {
      contents = await fs.promises.readFile(this.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(EMPTY_CACHE)
      throw new Error(`Could not read translation cache ${this.file}: ${error instanceof Error ? error.message : String(error)}`)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(contents) as unknown
    } catch (error) {
      throw new Error(`Translation cache is corrupted at ${this.file}: ${error instanceof Error ? error.message : String(error)}`)
    }

    if (!isObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      throw new Error(`Translation cache is corrupted at ${this.file}: expected version 1 with an entries array.`)
    }

    try {
      return {entries: parsed.entries.map((entry, index) => parseEntry(entry, index)), version: 1}
    } catch (error) {
      throw new Error(`Translation cache is corrupted at ${this.file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(() => {}, () => {})
    return result
  }

  private async write(cache: ITranslationCacheFile): Promise<void> {
    await writeFileAtomic(this.file, `${JSON.stringify(cache, null, 2)}\n`)
  }
}
