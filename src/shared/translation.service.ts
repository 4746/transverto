import {IConfig} from './config.js'
import {
  resolveEngineProfile,
  validateEngineConfiguration,
  validateFallbackConfiguration,
} from './engine-profile.js'
import {OpenAICompatibleEngine} from './engines/openai-compatible.engine.js'
import {
  isRecoverableTranslationError,
  toTranslationError,
  TranslationError,
} from './entities/translation-error.js'
import {
  IMultiLanguageTranslationAttempt,
  IMultiLanguageTranslationRequestPlan,
  IResolvedEngineProfile,
  ITranslationRequestPlan,
  ITranslationResult,
  TranslationEngine,
} from './entities/translation.engine.js'
import {comparePlaceholders} from './placeholder.js'
import {TranslationCacheService} from './translation-cache.service.js'

interface ITranslationRuntime {
  engine: TranslationEngine
  profile: IResolvedEngineProfile
}

interface ITranslationResultOptions {
  cached: boolean
  fallbackFrom?: string
  translatedText: string
}

export interface ITranslationServiceOptions {
  cacheFile: string
  deferCacheWrites?: boolean
  environment?: NodeJS.ProcessEnv
  fallback?: null | string
  selectedEngine?: string
}

const validateRequest = (request: ITranslationRequestPlan): void => {
  if (!request.from || !request.to) {
    throw new TranslationError('validation', 'Source and target languages are required.')
  }

  if (request.from === request.to) {
    throw new TranslationError('validation', 'Source and target languages must differ.')
  }

  if (!request.sourceText || request.sourceText.trim().length === 0) {
    throw new TranslationError('validation', 'Source text must not be empty.')
  }
}

const validateBatchRequest = (request: IMultiLanguageTranslationRequestPlan): void => {
  if (!request.from || !request.sourceText || request.sourceText.trim().length === 0) {
    throw new TranslationError('validation', 'Source language and text are required.')
  }

  if (request.targets.length === 0) throw new TranslationError('validation', 'At least one target language is required.')
  if (new Set(request.targets).size !== request.targets.length) {
    throw new TranslationError('validation', 'Target languages must not contain duplicates.')
  }

  if (request.targets.includes(request.from)) {
    throw new TranslationError('validation', 'Source and target languages must differ.')
  }
}

export class TranslationService {
  private constructor(
    private readonly primary: ITranslationRuntime,
    private readonly fallback: ITranslationRuntime | undefined,
    private readonly cache: TranslationCacheService,
    private readonly deferCacheWrites: boolean,
  ) {}

  static fromConfig(
    config: IConfig,
    options: ITranslationServiceOptions,
  ): TranslationService {
    const environment = options.environment ?? process.env

    try {
      const primaryProfile = resolveEngineProfile(
        config,
        options.selectedEngine,
        environment,
        {requireCredentials: false},
      )
      const engines = validateEngineConfiguration(config.engine, config.engines)
      const fallbackSetting = Object.hasOwn(options, 'fallback')
        ? options.fallback
        : config.fallback
      const fallbackName = validateFallbackConfiguration(
        fallbackSetting,
        engines,
        primaryProfile.name,
      )
      const fallbackProfile = fallbackName
        ? resolveEngineProfile(config, fallbackName, environment, {requireCredentials: false})
        : undefined
      const cache = new TranslationCacheService(options.cacheFile, config.cache)

      return new TranslationService(
        {engine: new OpenAICompatibleEngine(primaryProfile), profile: primaryProfile},
        fallbackProfile
          ? {engine: new OpenAICompatibleEngine(fallbackProfile), profile: fallbackProfile}
          : undefined,
        cache,
        options.deferCacheWrites ?? false,
      )
    } catch (error) {
      throw toTranslationError(error, 'configuration')
    }
  }

  async cacheResults(results: ITranslationResult[]): Promise<void> {
    try {
      for (const result of results) {
        if (result.cached) continue
        const runtime = result.engine === this.primary.profile.name ? this.primary : this.fallback
        if (!runtime || runtime.profile.model !== result.model) {
          throw new TranslationError('configuration', `Unknown result engine "${result.engine}".`)
        }

        await this.cache.set(this.identity(runtime.profile, result), result.translatedText)
      }
    } catch (error) {
      throw toTranslationError(error, 'configuration')
    }
  }

  async translate(request: ITranslationRequestPlan): Promise<ITranslationResult> {
    validateRequest(request)

    const primaryCached = await this.getCached(this.primary, request)
    if (primaryCached) return primaryCached

    if (this.fallback) {
      const fallbackCached = await this.getCached(this.fallback, request, this.primary.profile.name)
      if (fallbackCached) return fallbackCached
    }

    try {
      return await this.translateWith(this.primary, request)
    } catch (error) {
      const translationError = toTranslationError(error, 'provider_response', undefined, {
        profile: this.primary.profile,
      })
      if (!this.fallback || !isRecoverableTranslationError(translationError)) {
        throw translationError
      }
    }

    return this.translateWith(this.fallback, request, this.primary.profile.name)
  }

  async translateBatch(request: IMultiLanguageTranslationRequestPlan): Promise<IMultiLanguageTranslationAttempt> {
    validateBatchRequest(request)
    const cached: ITranslationResult[] = []
    const missing: string[] = []
    for (const to of request.targets) {
      const single = this.singleRequest(request, to)
      const primaryCached = await this.getCached(this.primary, single)
      if (primaryCached) { cached.push(primaryCached); continue }
      const fallbackCached = this.fallback
        ? await this.getCached(this.fallback, single, this.primary.profile.name)
        : undefined
      if (fallbackCached) cached.push(fallbackCached)
      else missing.push(to)
    }

    let fresh: IMultiLanguageTranslationAttempt = {
      issues: [], request: {...request, targets: []}, results: [], translations: {}, unexpectedTargets: [],
    }
    if (missing.length > 0) {
      const uncached = {...request, targets: missing}
      try {
        fresh = await this.translateBatchWith(this.primary, uncached)
      } catch (error) {
        const translationError = toTranslationError(error, 'provider_response', undefined, {profile: this.primary.profile})
        if (!this.fallback || !isRecoverableTranslationError(translationError)) throw translationError
        fresh = await this.translateBatchWith(this.fallback, uncached, this.primary.profile.name)
      }
    }

    const byTarget = new Map([...cached, ...fresh.results].map(result => [result.to, result]))
    return {
      ...fresh,
      request,
      results: request.targets.flatMap(target => {
        const result = byTarget.get(target)
        return result ? [result] : []
      }),
    }
  }

  private async getCached(
    runtime: ITranslationRuntime,
    request: ITranslationRequestPlan,
    fallbackFrom?: string,
  ): Promise<ITranslationResult | undefined> {
    let cachedEntry
    try {
      cachedEntry = await this.cache.get(this.identity(runtime.profile, request))
    } catch (error) {
      throw toTranslationError(error, 'configuration')
    }

    if (!cachedEntry) return
    return this.result(runtime.profile, request, {
      cached: true,
      fallbackFrom,
      translatedText: cachedEntry.translatedText,
    })
  }

  private identity(
    profile: IResolvedEngineProfile,
    request: ITranslationRequestPlan,
  ) {
    return {
      from: request.from,
      model: profile.model,
      profile: profile.name,
      sourceText: request.sourceText,
      to: request.to,
    }
  }

  private result(
    profile: IResolvedEngineProfile,
    request: ITranslationRequestPlan,
    options: ITranslationResultOptions,
  ): ITranslationResult {
    return {
      ...request,
      cached: options.cached,
      engine: profile.name,
      ...(options.fallbackFrom ? {fallback: {from: options.fallbackFrom}} : {}),
      model: profile.model,
      provider: profile.provider,
      translatedText: options.translatedText,
    }
  }

  private singleRequest(request: IMultiLanguageTranslationRequestPlan, to: string): ITranslationRequestPlan {
    return {from: request.from, ...(request.key ? {key: request.key} : {}), sourceText: request.sourceText, to}
  }

  private async translateBatchWith(
    runtime: ITranslationRuntime,
    request: IMultiLanguageTranslationRequestPlan,
    fallbackFrom?: string,
  ): Promise<IMultiLanguageTranslationAttempt> {
    if (!runtime.engine.translateBatch) {
      throw new TranslationError('configuration', `Engine profile "${runtime.profile.name}" does not support multi-language translation.`, {profile: runtime.profile})
    }

    let response
    try { response = await runtime.engine.translateBatch(request) }
    catch (error) { throw toTranslationError(error, 'provider_response', undefined, {profile: runtime.profile}) }

    const issues = [...response.issues]
    const invalid = new Set(issues.map(issue => issue.target))
    const results: ITranslationResult[] = []
    for (const target of request.targets) {
      const translatedText = response.translations[target]
      if (invalid.has(target) || translatedText === undefined) continue
      if (!comparePlaceholders(request.sourceText, translatedText).matches) {
        issues.push({reason: 'placeholder', target})
        continue
      }

      results.push(this.result(runtime.profile, this.singleRequest(request, target), {
        cached: false, fallbackFrom, translatedText,
      }))
    }

    return {...response, issues, request, results}
  }

  private async translateWith(
    runtime: ITranslationRuntime,
    request: ITranslationRequestPlan,
    fallbackFrom?: string,
  ): Promise<ITranslationResult> {
    let translatedText: string
    try {
      translatedText = (await runtime.engine.translate(request)).trim()
    } catch (error) {
      throw toTranslationError(error, 'provider_response', undefined, {profile: runtime.profile})
    }

    if (!translatedText) {
      throw new TranslationError(
        'provider_response',
        `Engine profile "${runtime.profile.name}" (${runtime.profile.model}) returned an empty translation.`,
        {profile: runtime.profile},
      )
    }

    if (!this.deferCacheWrites) {
      try {
        await this.cache.set(this.identity(runtime.profile, request), translatedText)
      } catch (error) {
        throw toTranslationError(error, 'configuration')
      }
    }

    return this.result(runtime.profile, request, {cached: false, fallbackFrom, translatedText})
  }
}
