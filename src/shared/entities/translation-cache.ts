export interface ITranslationCacheConfig {
  maxEntries: number
  ttlMs: null | number
}

export interface ITranslationCacheIdentity {
  from: string
  model: string
  profile: string
  sourceText: string
  to: string
}

export interface ITranslationCacheEntry extends ITranslationCacheIdentity {
  accessedAt: string
  createdAt: string
  id: string
  translatedText: string
}

export interface ITranslationCacheFile {
  entries: ITranslationCacheEntry[]
  version: 1
}

export interface ITranslationCacheFilters {
  from?: string
  model?: string
  profile?: string
  to?: string
}

export interface ITranslationCacheSummary {
  count: number
  oldestCreatedAt: null | string
  profiles: Array<{count: number; model: string; profile: string}>
}

export interface ITranslationCacheListResult {
  entries: ITranslationCacheEntry[]
  filters: ITranslationCacheFilters
  summary: ITranslationCacheSummary
}

export interface ITranslationCachePruneResult {
  expired: number
  remaining: number
  removed: number
  removedByLimit: number
}
